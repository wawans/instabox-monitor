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
