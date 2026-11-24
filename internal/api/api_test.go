package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"instabox-monitor/internal/config"
	"instabox-monitor/internal/crypto"
	"instabox-monitor/internal/instabox"
	"instabox-monitor/internal/poller"
	"instabox-monitor/internal/store"
)

func newTestServer(t *testing.T, password string) (*Server, *store.Store, *poller.Manager, *crypto.Cipher) {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Config{
		Port:                       8080,
		AppEnv:                     "production",
		DataDir:                    dir,
		AppKey:                     "integration-test-app-key",
		AppUsername:                "admin",
		AppPassword:                password,
		CookieSecure:               "false",
		PollIntervalSeconds:        30,
		MetricsPollIntervalSeconds: 0,
		AccountMaxAuthFailures:     3,
		AccountsSeedMode:           config.SeedModeSync,
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	ciph, err := crypto.New(cfg.AppKey, dir)
	if err != nil {
		t.Fatalf("crypto.New: %v", err)
	}
	pm := poller.NewManager(cfg, st, ciph, nil)
	if err := pm.Start(context.Background()); err != nil {
		t.Fatalf("pm.Start: %v", err)
	}
	t.Cleanup(pm.Stop)

	srv := NewServer(cfg, st, ciph, pm, nil, "test", nil)
	return srv, st, pm, ciph
}

func TestAuthLoginProtectedRoutesAndLogout(t *testing.T) {
	srv, _, _, _ := newTestServer(t, "topsecret")

	// Health is always public
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/health = %d, want 200", rec.Code)
	}

	// Fleet requires auth when APP_PASSWORD is set
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/fleet", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated GET /api/fleet = %d, want 401", rec.Code)
	}

	// Wrong password fails
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"wrong"}`))
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad login = %d, want 401", rec.Code)
	}

	// Correct login sets HttpOnly cookie
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"topsecret"}`))
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("good login = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != sessionCookieName || !cookies[0].HttpOnly {
		t.Fatalf("expected HttpOnly session cookie, got %+v", cookies)
	}

	// Authenticated request succeeds
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/fleet", nil)
	req.AddCookie(cookies[0])
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated GET /api/fleet = %d, want 200", rec.Code)
	}

	// Logout revokes session
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(cookies[0])
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout = %d, want 200", rec.Code)
	}

	// Reusing logged-out cookie fails
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/fleet", nil)
	req.AddCookie(cookies[0])
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("post-logout GET /api/fleet = %d, want 401", rec.Code)
	}
}

func TestBulkImportPartialSuccessDuplicateSkipAndZeroExport(t *testing.T) {
	mockAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		switch r.URL.Path {
		case "/v1/me":
			if key == "ibk_valid_one_1111" {
				_ = json.NewEncoder(w).Encode(instabox.Me{Login: "alice", Email: "alice@example.com"})
				return
			}
			if key == "ibk_valid_two_2222" {
				_ = json.NewEncoder(w).Encode(instabox.Me{Login: "bob", Email: "bob@example.com"})
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": "invalid_key", "message": "bad key"}})
		case "/v1/orgs":
			_ = json.NewEncoder(w).Encode(instabox.OrgList{})
		case "/v1/machines":
			_ = json.NewEncoder(w).Encode(instabox.MachineList{})
		case "/v1/ports":
			_ = json.NewEncoder(w).Encode(instabox.PublicPortList{})
		}
	}))
	defer mockAPI.Close()

	srv, _, _, _ := newTestServer(t, "")

	rawCSV := strings.Join([]string{
		"name,apiKey,readOnly",
		"Alice Prod,ibk_valid_one_1111,false",
		"ibk_valid_two_2222",
		"Alice Dup,ibk_valid_one_1111,true",
		"Bad Key,ibk_invalid_key_9999,false",
	}, "\n")

	payload, _ := json.Marshal(map[string]any{
		"raw":      rawCSV,
		"validate": true,
		"baseUrl":  mockAPI.URL,
	})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/accounts/bulk", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/accounts/bulk = %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Total   int                 `json:"total"`
		Created int                 `json:"created"`
		Skipped int                 `json:"skipped"`
		Failed  int                 `json:"failed"`
		Results []bulkAccountResult `json:"results"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Total != 4 || resp.Created != 2 || resp.Skipped != 1 || resp.Failed != 1 {
		t.Fatalf("unexpected bulk result: %+v", resp)
	}
	// Bare key line should have auto-named from /v1/me ("bob")
	if resp.Results[1].Name != "bob" {
		t.Errorf("expected auto-named 'bob', got %q", resp.Results[1].Name)
	}

	// Zero-Export check: GET /api/accounts must NEVER contain plaintext keys
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/accounts", nil))
	bodyStr := rec.Body.String()
	if strings.Contains(bodyStr, "ibk_valid_one_1111") || strings.Contains(bodyStr, "ibk_valid_two_2222") {
		t.Fatalf("SECURITY VIOLATION: plaintext API key leaked in GET /api/accounts: %s", bodyStr)
	}
}

func TestWakeAllForceStopAndAdaptiveReadOnlyScope(t *testing.T) {
	var started, resumed, forceStopped atomic.Int32

	mockAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		switch r.URL.Path {
		case "/v1/machines":
			if key == "ibk_rw_key_1111" {
				_ = json.NewEncoder(w).Encode(instabox.MachineList{
					Machines: []instabox.Machine{
						{ID: "m_run", Name: "vm-run", OrgID: "org_a", State: "running", Spec: instabox.MachineSpec{VCPUs: 4, MemMiB: 8192}},
						{ID: "m_stop", Name: "vm-stop", OrgID: "org_a", State: "stopped", Spec: instabox.MachineSpec{VCPUs: 2, MemMiB: 4096}},
						{ID: "m_susp", Name: "vm-susp", OrgID: "org_a", State: "suspended", Spec: instabox.MachineSpec{VCPUs: 2, MemMiB: 4096}},
					},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(instabox.MachineList{
				Machines: []instabox.Machine{
					{ID: "m_ro_stop", Name: "vm-ro", OrgID: "org_b", State: "stopped"},
				},
			})
		case "/v1/ports":
			_ = json.NewEncoder(w).Encode(instabox.PublicPortList{})
		case "/v1/me":
			_ = json.NewEncoder(w).Encode(instabox.Me{Login: "ops"})
		case "/v1/orgs":
			_ = json.NewEncoder(w).Encode(instabox.OrgList{})
		case "/v1/machines/m_stop/start":
			started.Add(1)
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(instabox.Operation{ID: "op_start", MachineID: "m_stop", Type: "start", State: "succeeded"})
		case "/v1/machines/m_susp/resume":
			resumed.Add(1)
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(instabox.Operation{ID: "op_resume", MachineID: "m_susp", Type: "resume", State: "succeeded"})
		case "/v1/machines/m_run/stop":
			if r.URL.Query().Get("now") == "true" {
				forceStopped.Add(1)
			}
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(instabox.Operation{ID: "op_stop", MachineID: "m_run", Type: "stop", State: "succeeded"})
		case "/v1/machines/m_ro_stop/start":
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{"code": "missing_scope", "message": "requires machines:write"},
			})
		default:
			if strings.HasPrefix(r.URL.Path, "/v1/operations/") {
				_ = json.NewEncoder(w).Encode(instabox.Operation{ID: "op", State: "succeeded"})
				return
			}
			http.NotFound(w, r)
		}
	}))
	defer mockAPI.Close()

	srv, st, pm, ciph := newTestServer(t, "")

	encRW, _ := ciph.Encrypt("ibk_rw_key_1111")
	accRW, _ := st.CreateAccount(context.Background(), store.Account{
		ID: "acc-rw", Name: "RW", BaseURL: mockAPI.URL, APIKeyEnc: encRW, APIKeyHash: ciph.HashAPIKey("ibk_rw_key_1111"),
		KeyHint: "ibk_••••1111", Enabled: true, Source: store.SourceUI,
	})
	encRO, _ := ciph.Encrypt("ibk_ro_key_2222")
	accRO, _ := st.CreateAccount(context.Background(), store.Account{
		ID: "acc-ro", Name: "RO", BaseURL: mockAPI.URL, APIKeyEnc: encRO, APIKeyHash: ciph.HashAPIKey("ibk_ro_key_2222"),
		KeyHint: "ibk_••••2222", Enabled: true, ReadOnly: true, Source: store.SourceUI,
	})
	encScope, _ := ciph.Encrypt("ibk_scope_3333")
	accScope, _ := st.CreateAccount(context.Background(), store.Account{
		ID: "acc-scope", Name: "ScopeLimited", BaseURL: mockAPI.URL, APIKeyEnc: encScope, APIKeyHash: ciph.HashAPIKey("ibk_scope_3333"),
		KeyHint: "ibk_••••3333", Enabled: true, Source: store.SourceUI,
	})
	pm.ReconcileAccount(context.Background(), accRW.ID)
	pm.ReconcileAccount(context.Background(), accRO.ID)
	pm.ReconcileAccount(context.Background(), accScope.ID)

	// Wait for initial immediate polls to populate cache
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		snaps := pm.SnapshotCopy()
		if len(snaps[accRW.ID].Machines) == 3 && len(snaps[accRO.ID].Machines) == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// 1. Wake All across all accounts: triggers m_stop (start) + m_susp (resume), skips m_run (running) and acc-ro (read-only), fails acc-scope (403 missing_scope)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/fleet/wake-all", strings.NewReader(`{}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/fleet/wake-all = %d: %s", rec.Code, rec.Body.String())
	}
	var wakeResp struct {
		Total     int `json:"total"`
		Triggered int `json:"triggered"`
		Skipped   int `json:"skipped"`
		Failed    int `json:"failed"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &wakeResp)
	if wakeResp.Triggered != 2 || wakeResp.Skipped != 1 || wakeResp.Failed != 1 {
		t.Fatalf("unexpected wake-all response: %+v (%s)", wakeResp, rec.Body.String())
	}
	if started.Load() != 1 || resumed.Load() != 1 {
		t.Fatalf("expected 1 start & 1 resume, got start=%d resume=%d", started.Load(), resumed.Load())
	}

	// Verify acc-scope was automatically marked write_capable=false after 403 missing_scope
	updatedScope, _ := st.GetAccount(context.Background(), accScope.ID)
	if updatedScope.WriteCapable == nil || *updatedScope.WriteCapable {
		t.Fatalf("expected acc-scope WriteCapable=false after 403 missing_scope, got %+v", updatedScope.WriteCapable)
	}

	// 2. Force Stop action passes ?now=true
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/accounts/acc-rw/vms/m_run/actions/stop", strings.NewReader(`{"force":true,"machineName":"vm-run"}`)))
	if rec.Code != http.StatusAccepted || forceStopped.Load() != 1 {
		body, _ := io.ReadAll(rec.Body)
		t.Fatalf("force stop = %d (hits=%d): %s", rec.Code, forceStopped.Load(), string(body))
	}
}
