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

func TestAppPortPublishRotateUnpublishAndZeroLeak(t *testing.T) {
	var publishCalls, deleteCalls atomic.Int32

	mockAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/me":
			_ = json.NewEncoder(w).Encode(instabox.Me{Login: "ops"})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/orgs":
			_ = json.NewEncoder(w).Encode(instabox.OrgList{
				Orgs: []instabox.Org{{ID: "org_a", Name: "Production"}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/machines":
			_ = json.NewEncoder(w).Encode(instabox.MachineList{
				Machines: []instabox.Machine{
					{ID: "m_run", Name: "api-vm", OrgID: "org_a", State: "running"},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/ports":
			_ = json.NewEncoder(w).Encode(instabox.PublicPortList{Enabled: true, Ports: []instabox.PublicPort{}})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/machines/m_run/ports":
			_ = json.NewEncoder(w).Encode(instabox.PublicPortList{
				Enabled: true,
				Ports: []instabox.PublicPort{
					{
						ID:        "port_3000",
						MachineID: "m_run",
						Name:      "web",
						Port:      3000,
						Protocol:  "http",
						Access:    "private",
						URL:       "https://3000-mrun.instabox.sh",
						Token:     "ibp_should_never_pass_get",
						TokenURL:  "https://3000-mrun.instabox.sh?_token=ibp_should_never_pass_get",
					},
				},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/machines/m_run/ports":
			if key == "ibk_scope_3333" {
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error": map[string]any{"code": "missing_scope", "message": "machines:write required"},
				})
				return
			}
			publishCalls.Add(1)
			var req instabox.PublishPortRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode upstream publish: %v", err)
			}
			resp := instabox.PublicPort{
				ID:        "port_3000",
				MachineID: "m_run",
				Name:      req.Name,
				Port:      req.Port,
				Protocol:  req.Protocol,
				Access:    req.Access,
				URL:       "https://3000-mrun.instabox.sh",
			}
			if req.Access == "private" {
				tok := "ibp_secret_one_time_1"
				if req.RotateToken {
					tok = "ibp_secret_rotated_2"
				}
				resp.Token = tok
				resp.TokenURL = "https://3000-mrun.instabox.sh?_token=" + tok
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(resp)
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/machines/m_run/ports/3000":
			deleteCalls.Add(1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockAPI.Close()

	srv, st, pm, ciph := newTestServer(t, "")
	ctx := context.Background()

	createSeed := func(id, name, key string, readOnly, enabled bool) store.Account {
		enc, _ := ciph.Encrypt(key)
		acc, _ := st.CreateAccount(ctx, store.Account{
			ID: id, Name: name, BaseURL: mockAPI.URL, APIKeyEnc: enc, APIKeyHash: ciph.HashAPIKey(key),
			KeyHint: crypto.MaskAPIKey(key), Enabled: enabled, ReadOnly: readOnly, Source: store.SourceUI,
		})
		pm.ReconcileAccount(ctx, acc.ID)
		return acc
	}

	accRW := createSeed("acc-rw", "Alpha Account", "ibk_rw_1111", false, true)
	createSeed("acc-ro", "ReadOnly Account", "ibk_ro_2222", true, true)
	createSeed("acc-scope", "Scope Account", "ibk_scope_3333", false, true)
	createSeed("acc-dis", "Disabled Account", "ibk_dis_4444", false, false)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		snaps := pm.SnapshotCopy()
		if len(snaps[accRW.ID].Machines) == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// 1. Validation rejections (must fail before upstream).
	badPayloads := []struct {
		name string
		body string
	}{
		{"low port", `{"port":80,"protocol":"http","access":"public"}`},
		{"reserved 5901", `{"port":5901,"protocol":"http","access":"public"}`},
		{"reserved 6768", `{"port":6768,"protocol":"http","access":"public"}`},
		{"tcp private", `{"port":5432,"protocol":"tcp","access":"private"}`},
		{"rotate public", `{"port":3000,"protocol":"http","access":"public","rotateToken":true}`},
	}
	for _, tc := range badPayloads {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/accounts/acc-rw/vms/m_run/ports", strings.NewReader(tc.body)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400: %s", tc.name, rec.Code, rec.Body.String())
		}
	}
	if publishCalls.Load() != 0 {
		t.Fatalf("validation failures should not hit upstream, got %d calls", publishCalls.Load())
	}

	// 2. ReadOnly / Disabled / Missing Scope checks.
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/accounts/acc-ro/vms/m_run/ports", strings.NewReader(`{"port":3000}`)))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("read-only publish = %d, want 403", rec.Code)
	}

	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/accounts/acc-dis/vms/m_run/ports", strings.NewReader(`{"port":3000}`)))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("disabled publish = %d, want 403", rec.Code)
	}

	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/accounts/acc-scope/vms/m_run/ports", strings.NewReader(`{"port":3000}`)))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing_scope publish = %d, want 403", rec.Code)
	}
	scopeAcc, _ := st.GetAccount(ctx, "acc-scope")
	if scopeAcc.WriteCapable == nil || *scopeAcc.WriteCapable {
		t.Fatalf("expected acc-scope WriteCapable=false, got %+v", scopeAcc.WriteCapable)
	}

	// 3. Publish private HTTP port -> returns one-time token + tokenUrl in direct POST response only.
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/accounts/acc-rw/vms/m_run/ports", strings.NewReader(`{"port":3000,"name":"web","protocol":"http","access":"private"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST publish = %d: %s", rec.Code, rec.Body.String())
	}
	var pubResp instabox.PublicPort
	if err := json.Unmarshal(rec.Body.Bytes(), &pubResp); err != nil {
		t.Fatalf("decode publish response: %v", err)
	}
	if pubResp.Token != "ibp_secret_one_time_1" || !strings.Contains(pubResp.TokenURL, "ibp_secret_one_time_1") {
		t.Fatalf("expected one-time token and tokenUrl in POST response, got %+v", pubResp)
	}

	// 4. Rotate token -> returns new one-time secret in POST response.
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/accounts/acc-rw/vms/m_run/ports", strings.NewReader(`{"port":3000,"name":"web","protocol":"http","access":"private","rotateToken":true}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST rotate = %d: %s", rec.Code, rec.Body.String())
	}
	var rotResp instabox.PublicPort
	_ = json.Unmarshal(rec.Body.Bytes(), &rotResp)
	if rotResp.Token != "ibp_secret_rotated_2" || !strings.Contains(rotResp.TokenURL, "ibp_secret_rotated_2") {
		t.Fatalf("expected rotated secret in POST response, got %+v", rotResp)
	}

	// 5. Zero-Leak checks on GET /api/ports, GET machine ports, GET /api/activity, and SQLite snapshots.
	for _, endpoint := range []string{"/api/ports", "/api/accounts/acc-rw/vms/m_run/ports", "/api/activity"} {
		rec = httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, endpoint, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d", endpoint, rec.Code)
		}
		bodyStr := rec.Body.String()
		if strings.Contains(bodyStr, "ibp_secret_one_time_1") ||
			strings.Contains(bodyStr, "ibp_secret_rotated_2") ||
			strings.Contains(bodyStr, "ibp_should_never_pass_get") ||
			strings.Contains(bodyStr, "tokenUrl") {
			t.Fatalf("SECURITY VIOLATION: port token leaked in GET %s: %s", endpoint, bodyStr)
		}
	}

	// Verify GET /api/ports enriched metadata.
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/ports", nil))
	var portsResp struct {
		Ports []portView `json:"ports"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &portsResp)
	if len(portsResp.Ports) != 1 || portsResp.Ports[0].OrgName != "Production" ||
		portsResp.Ports[0].MachineName != "api-vm" || !portsResp.Ports[0].CanWrite {
		t.Fatalf("unexpected enriched ports response: %+v", portsResp.Ports)
	}

	// Verify SQLite snapshots contain zero tokens.
	snapsDB, _ := st.ListSnapshots(ctx)
	for _, s := range snapsDB {
		if strings.Contains(s.PortsJSON, "ibp_secret") || strings.Contains(s.PortsJSON, "tokenUrl") {
			t.Fatalf("SECURITY VIOLATION: port token stored in SQLite snapshot %s: %s", s.AccountID, s.PortsJSON)
		}
	}

	// 6. Unpublish port -> 204 and clears cached port.
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/accounts/acc-rw/vms/m_run/ports/3000", nil))
	if rec.Code != http.StatusNoContent || deleteCalls.Load() != 1 {
		t.Fatalf("DELETE unpublish = %d (hits=%d): %s", rec.Code, deleteCalls.Load(), rec.Body.String())
	}

	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/ports", nil))
	portsResp.Ports = nil
	_ = json.Unmarshal(rec.Body.Bytes(), &portsResp)
	if len(portsResp.Ports) != 0 {
		t.Fatalf("expected 0 ports after unpublish, got %+v", portsResp.Ports)
	}
}

func TestGetMachinePortsSyncsGlobalPortsCache(t *testing.T) {
	mockAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/me":
			_ = json.NewEncoder(w).Encode(instabox.Me{Login: "ops"})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/orgs":
			_ = json.NewEncoder(w).Encode(instabox.OrgList{Orgs: []instabox.Org{{ID: "org_a", Name: "Production"}}})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/machines":
			_ = json.NewEncoder(w).Encode(instabox.MachineList{
				Machines: []instabox.Machine{
					{ID: "m_run", Name: "api-vm", OrgID: "org_a", State: "running"},
					{ID: "m_other", Name: "db-vm", OrgID: "org_a", State: "running"},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/ports":
			_ = json.NewEncoder(w).Encode(instabox.PublicPortList{
				Enabled: true,
				Ports: []instabox.PublicPort{
					{ID: "port_4000", MachineID: "m_other", Name: "db", Port: 4000, Protocol: "tcp", Access: "public", Address: "4000-m_other.instabox.sh:443", URL: "tls://4000-m_other.instabox.sh:443"},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/machines/m_run/ports":
			_ = json.NewEncoder(w).Encode(instabox.PublicPortList{
				Enabled: true,
				Ports: []instabox.PublicPort{
					{
						ID:        "port_9090",
						MachineID: "m_run",
						Name:      "cli-prom",
						Port:      9090,
						Protocol:  "http",
						Access:    "private",
						URL:       "https://9090-mrun.instabox.sh",
						Token:     "ibp_cli_secret_must_be_stripped",
						TokenURL:  "https://9090-mrun.instabox.sh?_token=ibp_cli_secret_must_be_stripped",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockAPI.Close()

	srv, st, pm, ciph := newTestServer(t, "")
	ctx := context.Background()
	enc, _ := ciph.Encrypt("ibk_rw_9999")
	acc, _ := st.CreateAccount(ctx, store.Account{
		ID: "acc-rw", Name: "Alpha", BaseURL: mockAPI.URL, APIKeyEnc: enc, APIKeyHash: ciph.HashAPIKey("ibk_rw_9999"),
		KeyHint: "ibk_••••9999", Enabled: true, Source: store.SourceUI,
	})
	pm.ReconcileAccount(ctx, acc.ID)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if snaps := pm.SnapshotCopy(); len(snaps[acc.ID].Machines) == 2 && len(snaps[acc.ID].Ports) == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Calling machine ports endpoint fetches m_run:9090 (e.g., created via CLI) and syncs it into global cache.
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/accounts/acc-rw/vms/m_run/ports", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET machine ports = %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "ibp_cli_secret_must_be_stripped") {
		t.Fatalf("SECURITY VIOLATION: secret leaked from machine ports GET")
	}

	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/ports", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/ports = %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "ibp_cli_secret_must_be_stripped") {
		t.Fatalf("SECURITY VIOLATION: secret leaked into /api/ports cache")
	}
	var portsResp struct {
		Ports []portView `json:"ports"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &portsResp)
	if len(portsResp.Ports) != 2 {
		t.Fatalf("expected 2 ports (db:4000 preserved + cli-prom:9090 synced), got %+v", portsResp.Ports)
	}
}

func TestGetVMMetricsNormalizesSinceToRFC3339AndRejectsInvalid(t *testing.T) {
	var upstreamHits atomic.Int32
	mockAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/machines/m_run/metrics":
			upstreamHits.Add(1)
			sinceQ := r.URL.Query().Get("since")
			parsed, err := time.Parse(time.RFC3339, sinceQ)
			if err != nil {
				t.Errorf("upstream expected RFC 3339 since, got %q: %v", sinceQ, err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if ago := time.Since(parsed); ago < 59*time.Minute || ago > 61*time.Minute {
				t.Errorf("upstream expected since ~1h ago, got %s (ago=%v)", sinceQ, ago)
			}
			_ = json.NewEncoder(w).Encode(instabox.MachineMetrics{
				Metrics: []instabox.MachineMetric{{Timestamp: time.Now().UTC().Format(time.RFC3339), CPUUsedPct: 42}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockAPI.Close()

	srv, st, _, ciph := newTestServer(t, "")
	ctx := context.Background()
	enc, _ := ciph.Encrypt("ibk_rw_metrics")
	_, _ = st.CreateAccount(ctx, store.Account{
		ID: "acc-rw", Name: "Alpha", BaseURL: mockAPI.URL, APIKeyEnc: enc, APIKeyHash: ciph.HashAPIKey("ibk_rw_metrics"),
		KeyHint: "ibk_••••rics", Enabled: true, Source: store.SourceUI,
	})

	// 1. Valid duration query (?since=1h) normalizes to RFC 3339 before reaching InstaBox.
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/accounts/acc-rw/vms/m_run/metrics?since=1h", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET metrics?since=1h = %d: %s", rec.Code, rec.Body.String())
	}

	// 2. Invalid since query returns 400 invalid_since locally without hitting upstream.
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/accounts/acc-rw/vms/m_run/metrics?since=notaduration", nil))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_since") {
		t.Fatalf("GET metrics?since=notaduration = %d: %s", rec.Code, rec.Body.String())
	}
	if upstreamHits.Load() != 1 {
		t.Fatalf("expected 1 upstream hit total, got %d", upstreamHits.Load())
	}
}
