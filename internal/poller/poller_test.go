package poller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"instabox-monitor/internal/config"
	"instabox-monitor/internal/crypto"
	"instabox-monitor/internal/instabox"
	"instabox-monitor/internal/store"
)

func setupTestEnv(t *testing.T) (*store.Store, *crypto.Cipher) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ciph, err := crypto.New("test-poller-app-key", dir)
	if err != nil {
		t.Fatalf("crypto.New: %v", err)
	}
	return st, ciph
}

func createAcc(t *testing.T, st *store.Store, ciph *crypto.Cipher, id, name, baseURL, apiKey string) store.Account {
	t.Helper()
	enc, err := ciph.Encrypt(apiKey)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	acc, err := st.CreateAccount(context.Background(), store.Account{
		ID:         id,
		Name:       name,
		BaseURL:    baseURL,
		APIKeyEnc:  enc,
		APIKeyHash: ciph.HashAPIKey(apiKey),
		KeyHint:    crypto.MaskAPIKey(apiKey),
		Enabled:    true,
		Source:     store.SourceUI,
	})
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
	return acc
}

func TestStartupFreshnessCheckColdStaleAndFresh(t *testing.T) {
	st, ciph := setupTestEnv(t)

	var coldHits, staleHits, freshHits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("X-API-Key") {
		case "ibk_cold":
			if r.URL.Path == "/v1/machines" {
				coldHits.Add(1)
				_ = json.NewEncoder(w).Encode(instabox.MachineList{Machines: []instabox.Machine{{ID: "m_cold", Name: "cold-vm", State: "stopped"}}})
				return
			}
		case "ibk_stale":
			if r.URL.Path == "/v1/machines" {
				staleHits.Add(1)
				_ = json.NewEncoder(w).Encode(instabox.MachineList{Machines: []instabox.Machine{{ID: "m_stale", Name: "stale-vm", State: "stopped"}}})
				return
			}
		case "ibk_fresh":
			if r.URL.Path == "/v1/machines" {
				freshHits.Add(1)
				_ = json.NewEncoder(w).Encode(instabox.MachineList{Machines: []instabox.Machine{{ID: "m_fresh", Name: "fresh-vm", State: "stopped"}}})
				return
			}
		}
		switch r.URL.Path {
		case "/v1/ports":
			_ = json.NewEncoder(w).Encode(instabox.PublicPortList{})
		case "/v1/me":
			_ = json.NewEncoder(w).Encode(instabox.Me{Login: "tester"})
		case "/v1/orgs":
			_ = json.NewEncoder(w).Encode(instabox.OrgList{})
		}
	}))
	defer srv.Close()

	createAcc(t, st, ciph, "acc-cold", "Cold", srv.URL, "ibk_cold")
	createAcc(t, st, ciph, "acc-stale", "Stale", srv.URL, "ibk_stale")
	createAcc(t, st, ciph, "acc-fresh", "Fresh", srv.URL, "ibk_fresh")

	now := time.Now().UTC()
	// Stale snapshot (10m old) -> must poll immediately
	_ = st.SaveSnapshot(context.Background(), store.AccountSnapshot{
		AccountID:    "acc-stale",
		MachinesJSON: `[{"id":"m_old","name":"old","state":"stopped"}]`,
		FetchedAt:    now.Add(-10 * time.Minute),
	})
	// Fresh snapshot (just fetched) -> must NOT poll immediately
	_ = st.SaveSnapshot(context.Background(), store.AccountSnapshot{
		AccountID:    "acc-fresh",
		MachinesJSON: `[{"id":"m_cached","name":"cached-vm","state":"running"}]`,
		FetchedAt:    now,
	})

	cfg := config.Config{
		PollIntervalSeconds:        30,
		MetricsPollIntervalSeconds: 0,
		AccountMaxAuthFailures:     3,
	}
	mgr := NewManager(cfg, st, ciph, nil)
	mgr.pollInterval = 10 * time.Second
	if err := mgr.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer mgr.Stop()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if coldHits.Load() >= 1 && staleHits.Load() >= 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if coldHits.Load() < 1 {
		t.Errorf("expected cold account to trigger immediate poll, got %d hits", coldHits.Load())
	}
	if staleHits.Load() < 1 {
		t.Errorf("expected stale account to trigger immediate poll, got %d hits", staleHits.Load())
	}
	if freshHits.Load() != 0 {
		t.Errorf("expected fresh account to skip immediate poll, got %d hits", freshHits.Load())
	}
	snaps := mgr.SnapshotCopy()
	if len(snaps["acc-fresh"].Machines) != 1 || snaps["acc-fresh"].Machines[0].ID != "m_cached" {
		t.Errorf("expected fresh account to serve cached snapshot, got %+v", snaps["acc-fresh"].Machines)
	}
}

func TestPerAccountIsolationAutoDisable401AndNon401Resilience(t *testing.T) {
	st, ciph := setupTestEnv(t)

	var goodHits, authHits, err500Hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		if r.URL.Path == "/v1/machines" {
			switch key {
			case "ibk_good":
				goodHits.Add(1)
				_ = json.NewEncoder(w).Encode(instabox.MachineList{Machines: []instabox.Machine{{ID: "m_ok", Name: "ok-vm", State: "running"}}})
				return
			case "ibk_bad401":
				authHits.Add(1)
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error": map[string]any{"code": "expired_key", "message": "key expired"},
				})
				return
			case "ibk_err500":
				err500Hits.Add(1)
				w.WriteHeader(http.StatusInternalServerError)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error": map[string]any{"code": "internal", "message": "upstream down"},
				})
				return
			}
		}
		switch r.URL.Path {
		case "/v1/ports":
			_ = json.NewEncoder(w).Encode(instabox.PublicPortList{})
		case "/v1/me":
			_ = json.NewEncoder(w).Encode(instabox.Me{Login: "ok"})
		case "/v1/orgs":
			_ = json.NewEncoder(w).Encode(instabox.OrgList{})
		case "/v1/machines/m_ok/metrics":
			_ = json.NewEncoder(w).Encode(instabox.MachineMetrics{
				Metrics: []instabox.MachineMetric{{Timestamp: "2026-11-24T10:00:00Z", CPUUsedPct: 25, MemUsed: 512, MemTotal: 1024}},
			})
		}
	}))
	defer srv.Close()

	createAcc(t, st, ciph, "acc-good", "Good", srv.URL, "ibk_good")
	createAcc(t, st, ciph, "acc-401", "Bad401", srv.URL, "ibk_bad401")
	createAcc(t, st, ciph, "acc-500", "Err500", srv.URL, "ibk_err500")

	// Also add a 4th account encrypted with a DIFFERENT APP_KEY to verify non-blocking key_error.
	otherCiph, _ := crypto.New("wrong-old-key", t.TempDir())
	wrongEnc, _ := otherCiph.Encrypt("ibk_cannot_decrypt")
	_, _ = st.CreateAccount(context.Background(), store.Account{
		ID:         "acc-keyerr",
		Name:       "KeyErr",
		BaseURL:    srv.URL,
		APIKeyEnc:  wrongEnc,
		APIKeyHash: "oldhash",
		KeyHint:    "ibk_••••rypt",
		Enabled:    true,
		Source:     store.SourceUI,
	})

	cfg := config.Config{
		PollIntervalSeconds:        5,
		MetricsPollIntervalSeconds: 5,
		AccountMaxAuthFailures:     3,
	}
	mgr := NewManager(cfg, st, ciph, nil)
	mgr.pollInterval = 25 * time.Millisecond
	mgr.metricsPollInterval = 25 * time.Millisecond

	if err := mgr.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer mgr.Stop()

	// Wait until bad401 hits 3 failures and gets auto-disabled, while good keeps succeeding.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		acc401, _ := st.GetAccount(context.Background(), "acc-401")
		if acc401.LastSyncStatus == store.StatusAutoDisabled && goodHits.Load() >= 2 && err500Hits.Load() >= 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	acc401, _ := st.GetAccount(context.Background(), "acc-401")
	if acc401.Enabled || acc401.LastSyncStatus != store.StatusAutoDisabled || acc401.ConsecutiveAuthFailures != 3 {
		t.Fatalf("expected acc-401 auto_disabled after 3x 401, got: %+v", acc401)
	}
	// Verify poller actually stopped hitting 401 after auto-disable.
	hitsAfterDisable := authHits.Load()
	time.Sleep(100 * time.Millisecond)
	if authHits.Load() != hitsAfterDisable {
		t.Errorf("expected auto-disabled account to stop polling, hits grew %d -> %d", hitsAfterDisable, authHits.Load())
	}

	// Verify 500 error did NOT increment auth failures or auto-disable.
	acc500, _ := st.GetAccount(context.Background(), "acc-500")
	if !acc500.Enabled || acc500.ConsecutiveAuthFailures != 0 || acc500.LastSyncStatus != store.StatusError {
		t.Fatalf("expected acc-500 to remain enabled with 0 auth failures, got: %+v", acc500)
	}

	// Verify key_error account was marked gracefully without blocking startup or other accounts.
	accKeyErr, _ := st.GetAccount(context.Background(), "acc-keyerr")
	if accKeyErr.LastSyncStatus != store.StatusKeyError {
		t.Fatalf("expected acc-keyerr status=key_error, got %+v", accKeyErr)
	}

	// Verify good account kept polling and populated tiered live metrics.
	snaps := mgr.SnapshotCopy()
	if len(snaps["acc-good"].Machines) != 1 || snaps["acc-good"].LiveMetrics["m_ok"].CPUUsedPct != 25 {
		t.Fatalf("expected good account snapshot + live metrics, got %+v", snaps["acc-good"])
	}
}

func TestPortCacheUpsertStripsTokenAndRemoveUpdatesSnapshot(t *testing.T) {
	st, ciph := setupTestEnv(t)
	ctx := context.Background()
	createAcc(t, st, ciph, "acc-1", "Acct 1", "https://example.invalid", "ibk_1")

	mgr := NewManager(config.Config{
		PollIntervalSeconds:        10,
		MetricsPollIntervalSeconds: 10,
		AccountMaxAuthFailures:     3,
	}, st, ciph, nil)

	// Insert private port with secret Token and TokenURL.
	mgr.UpsertCachedPort(ctx, "acc-1", instabox.PublicPort{
		ID:        "port_3000",
		MachineID: "m_1",
		Name:      "web",
		Port:      3000,
		Protocol:  "http",
		Access:    "private",
		URL:       "https://3000-m1.instabox.sh",
		Token:     "ibp_secret_should_never_persist",
		TokenURL:  "https://3000-m1.instabox.sh?_token=ibp_secret_should_never_persist",
	})

	snap, ok := mgr.SnapshotCopy()["acc-1"]
	if !ok || len(snap.Ports) != 1 {
		t.Fatalf("expected 1 cached port, got ok=%v snap=%+v", ok, snap)
	}
	if snap.Ports[0].Token != "" || snap.Ports[0].TokenURL != "" {
		t.Fatalf("expected Token and TokenURL stripped from memory cache, got %+v", snap.Ports[0])
	}

	dbSnaps, err := st.ListSnapshots(ctx)
	if err != nil {
		t.Fatalf("ListSnapshots: %v", err)
	}
	var found bool
	for _, s := range dbSnaps {
		if s.AccountID != "acc-1" {
			continue
		}
		found = true
		var ports []instabox.PublicPort
		if err := json.Unmarshal([]byte(s.PortsJSON), &ports); err != nil {
			t.Fatalf("unmarshal PortsJSON: %v", err)
		}
		if len(ports) != 1 || ports[0].Port != 3000 || ports[0].Token != "" || ports[0].TokenURL != "" {
			t.Fatalf("expected sanitized port in SQLite snapshot, got %+v (raw=%s)", ports, s.PortsJSON)
		}
	}
	if !found {
		t.Fatalf("expected snapshot row for acc-1")
	}

	// Update existing port and confirm upsert replaces in place without leaking new token.
	mgr.UpsertCachedPort(ctx, "acc-1", instabox.PublicPort{
		ID:        "port_3000",
		MachineID: "m_1",
		Name:      "web-public",
		Port:      3000,
		Protocol:  "http",
		Access:    "public",
		URL:       "https://3000-m1.instabox.sh",
		Token:     "ibp_rotated_secret_should_not_leak",
		TokenURL:  "https://3000-m1.instabox.sh?_token=ibp_rotated_secret_should_not_leak",
	})
	snap = mgr.SnapshotCopy()["acc-1"]
	if len(snap.Ports) != 1 || snap.Ports[0].Name != "web-public" || snap.Ports[0].Access != "public" ||
		snap.Ports[0].Token != "" || snap.Ports[0].TokenURL != "" {
		t.Fatalf("expected updated sanitized port, got %+v", snap.Ports)
	}

	// Remove port and verify cache + SQLite snapshot reflect removal.
	mgr.RemoveCachedPort(ctx, "acc-1", "m_1", 3000)
	if len(mgr.SnapshotCopy()["acc-1"].Ports) != 0 {
		t.Fatalf("expected 0 cached ports after remove, got %+v", mgr.SnapshotCopy()["acc-1"].Ports)
	}
	dbSnaps, err = st.ListSnapshots(ctx)
	if err != nil {
		t.Fatalf("ListSnapshots after remove: %v", err)
	}
	for _, s := range dbSnaps {
		if s.AccountID == "acc-1" {
			var ports []instabox.PublicPort
			if err := json.Unmarshal([]byte(s.PortsJSON), &ports); err != nil {
				t.Fatalf("unmarshal PortsJSON after remove: %v", err)
			}
			if len(ports) != 0 {
				t.Fatalf("expected 0 ports in SQLite after remove, got %+v", ports)
			}
		}
	}
}

func TestReplaceMachineCachedPortsPreservesOtherVMsAndStripsTokens(t *testing.T) {
	st, ciph := setupTestEnv(t)
	ctx := context.Background()
	createAcc(t, st, ciph, "acc-1", "Acct 1", "https://example.invalid", "ibk_1")

	mgr := NewManager(config.Config{
		PollIntervalSeconds:        10,
		MetricsPollIntervalSeconds: 10,
		AccountMaxAuthFailures:     3,
	}, st, ciph, nil)

	// Seed ports on m_1 and m_2.
	mgr.UpsertCachedPort(ctx, "acc-1", instabox.PublicPort{
		ID: "port_3000", MachineID: "m_1", Name: "old", Port: 3000, Protocol: "http", Access: "public", URL: "https://3000-m1.instabox.sh",
	})
	mgr.UpsertCachedPort(ctx, "acc-1", instabox.PublicPort{
		ID: "port_8080", MachineID: "m_2", Name: "other-vm", Port: 8080, Protocol: "http", Access: "public", URL: "https://8080-m2.instabox.sh",
	})

	ch, unsub := mgr.Broker().Subscribe()
	defer unsub()

	livePorts := []instabox.PublicPort{
		{ID: "port_3000", MachineID: "m_1", Name: "web-live", Port: 3000, Protocol: "http", Access: "public", URL: "https://3000-m1.instabox.sh"},
		{ID: "port_5173", MachineID: "", Name: "vite", Port: 5173, Protocol: "http", Access: "private", URL: "https://5173-m1.instabox.sh", Token: "ibp_live_secret", TokenURL: "https://5173-m1.instabox.sh?_token=ibp_live_secret"},
	}
	mgr.ReplaceMachineCachedPorts(ctx, "acc-1", "m_1", livePorts)

	// Should publish 1 fleet_updated event on change.
	select {
	case <-ch:
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("expected fleet_updated SSE event after ReplaceMachineCachedPorts")
	}

	snap := mgr.SnapshotCopy()["acc-1"]
	if len(snap.Ports) != 3 {
		t.Fatalf("expected 3 total ports (2 on m_1, 1 on m_2), got %+v", snap.Ports)
	}
	var m2Found, m1ViteFound bool
	for _, p := range snap.Ports {
		if p.Token != "" || p.TokenURL != "" {
			t.Fatalf("SECURITY VIOLATION: token leaked in cached port %+v", p)
		}
		if p.MachineID == "m_2" && p.Port == 8080 {
			m2Found = true
		}
		if p.MachineID == "m_1" && p.Port == 5173 && p.Name == "vite" {
			m1ViteFound = true
		}
	}
	if !m2Found || !m1ViteFound {
		t.Fatalf("expected m_2:8080 preserved and m_1:5173 added, got %+v", snap.Ports)
	}

	// Verify SQLite snapshot persisted the sync cleanly with 0 secrets.
	dbSnaps, err := st.ListSnapshots(ctx)
	if err != nil {
		t.Fatalf("ListSnapshots: %v", err)
	}
	for _, s := range dbSnaps {
		if s.AccountID == "acc-1" {
			var ports []instabox.PublicPort
			if err := json.Unmarshal([]byte(s.PortsJSON), &ports); err != nil {
				t.Fatalf("unmarshal PortsJSON: %v", err)
			}
			if len(ports) != 3 {
				t.Fatalf("expected 3 ports in SQLite snapshot, got %+v", ports)
			}
		}
	}

	// Repeating identical live ports must NOT emit another SSE broadcast.
	mgr.ReplaceMachineCachedPorts(ctx, "acc-1", "m_1", livePorts)
	select {
	case msg := <-ch:
		t.Fatalf("expected no SSE event when ports are unchanged, got %s", string(msg))
	case <-time.After(50 * time.Millisecond):
	}
}
