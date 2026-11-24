package instabox

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClientMonitoringAndPagination(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "ibk_test_valid" {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":    "invalid_key",
					"message": "bad key",
					"hint":    "check API key",
				},
			})
			return
		}
		switch r.URL.Path {
		case "/v1/me":
			_ = json.NewEncoder(w).Encode(Me{UserID: 1, Login: "wawans", Email: "w@example.com"})
		case "/v1/orgs":
			_ = json.NewEncoder(w).Encode(OrgList{Orgs: []Org{{ID: "org_1", Name: "Prod", Tier: "pro"}}})
		case "/v1/machines":
			cur := r.URL.Query().Get("cursor")
			if cur == "" {
				next := "page2"
				_ = json.NewEncoder(w).Encode(MachineList{
					Machines:   []Machine{{ID: "m_1", Name: "vm-1", State: "running"}},
					NextCursor: &next,
				})
			} else if cur == "page2" {
				_ = json.NewEncoder(w).Encode(MachineList{
					Machines:   []Machine{{ID: "m_2", Name: "vm-2", State: "stopped"}},
					NextCursor: nil,
				})
			}
		case "/v1/machines/m_1/metrics":
			if r.URL.Query().Get("since") != "1h" {
				t.Errorf("expected since=1h, got %q", r.URL.Query().Get("since"))
			}
			_ = json.NewEncoder(w).Encode(MachineMetrics{
				Metrics: []MachineMetric{{Timestamp: "2026-11-24T10:00:00Z", CPUUsedPct: 33.5, MemUsed: 1024, MemTotal: 4096}},
				Disk: &MachineDisk{
					Filesystems: []MachineFilesystem{{Mount: "/data", UsedPct: 45, Level: "ok"}},
				},
			})
		case "/v1/machines/m_1/disk":
			_ = json.NewEncoder(w).Encode(MachineDisk{
				Filesystems: []MachineFilesystem{{Mount: "/data", UsedPct: 88, Level: "high"}},
				Warning:     &DiskWarning{Level: "high", Mount: "/data", Message: "Disk high"},
			})
		case "/v1/machines/m_1/processes":
			_ = json.NewEncoder(w).Encode(ProcessList{
				MachineID: "m_1", Live: true,
				Processes: []Process{{PID: 1, Command: "/sbin/init"}},
			})
		case "/v1/machines/m_1/logs":
			_ = json.NewEncoder(w).Encode(MachineLogs{
				MachineID: "m_1", Console: "boot ok\n", Cursor: 120,
				Operations: []Operation{{ID: "op_1", Type: "start", State: "succeeded"}},
			})
		case "/v1/ports":
			_ = json.NewEncoder(w).Encode(PublicPortList{
				Enabled: true,
				Ports:   []PublicPort{{ID: "p_1", MachineID: "m_1", Port: 3000, Access: "public", URL: "https://m1.instabox.sh"}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "ibk_test_valid")
	ctx := context.Background()

	me, err := c.GetMe(ctx)
	if err != nil || me.Login != "wawans" {
		t.Fatalf("GetMe = (%+v, %v)", me, err)
	}
	orgs, err := c.ListOrgs(ctx)
	if err != nil || len(orgs) != 1 || orgs[0].Tier != "pro" {
		t.Fatalf("ListOrgs = (%+v, %v)", orgs, err)
	}
	machines, err := c.ListMachines(ctx)
	if err != nil || len(machines) != 2 || machines[0].ID != "m_1" || machines[1].ID != "m_2" {
		t.Fatalf("ListMachines pagination = (%+v, %v)", machines, err)
	}
	metrics, err := c.GetMachineMetrics(ctx, "m_1", "1h")
	if err != nil || len(metrics.Metrics) != 1 || metrics.Disk == nil {
		t.Fatalf("GetMachineMetrics = (%+v, %v)", metrics, err)
	}
	disk, err := c.GetMachineDisk(ctx, "m_1")
	if err != nil || disk.Warning == nil || disk.Warning.Level != "high" {
		t.Fatalf("GetMachineDisk = (%+v, %v)", disk, err)
	}
	procs, err := c.GetMachineProcesses(ctx, "m_1")
	if err != nil || !procs.Live || len(procs.Processes) != 1 {
		t.Fatalf("GetMachineProcesses = (%+v, %v)", procs, err)
	}
	logs, err := c.GetMachineLogs(ctx, "m_1", 200, 0)
	if err != nil || logs.Cursor != 120 || len(logs.Operations) != 1 {
		t.Fatalf("GetMachineLogs = (%+v, %v)", logs, err)
	}
	ports, err := c.ListPorts(ctx)
	if err != nil || len(ports.Ports) != 1 {
		t.Fatalf("ListPorts = (%+v, %v)", ports, err)
	}
}

func TestClientLifecycleIdempotencyForceStopAndErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/machines/m_1/start", "/v1/machines/m_1/suspend", "/v1/machines/m_1/resume":
			if r.Header.Get("Idempotency-Key") == "" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(Operation{ID: "op_123", MachineID: "m_1", State: "running"})
		case "/v1/machines/m_1/stop":
			if r.Header.Get("Idempotency-Key") == "" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			phase := "graceful"
			if r.URL.Query().Get("now") == "true" {
				phase = "forced"
			}
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(Operation{ID: "op_stop", MachineID: "m_1", State: "running", Phase: phase})
		case "/v1/operations/op_123":
			_ = json.NewEncoder(w).Encode(Operation{ID: "op_123", State: "succeeded"})
		case "/v1/machines/m_ro/start":
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":           "missing_scope",
					"message":        "needs machines:write",
					"requiredScopes": []string{"machines:write"},
				},
			})
		case "/v1/machines/m_429/start":
			w.Header().Set("Retry-After", "45")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":              "rate_limited",
					"message":           "slow down",
					"retryAfterSeconds": 45,
				},
			})
		case "/v1/machines/m_401/start":
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":    "expired_key",
					"message": "key expired",
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "ibk_test")
	ctx := context.Background()

	op, err := c.StartMachine(ctx, "m_1")
	if err != nil || op.ID != "op_123" {
		t.Fatalf("StartMachine = (%+v, %v)", op, err)
	}
	stopOp, err := c.StopMachine(ctx, "m_1", true)
	if err != nil || stopOp.Phase != "forced" {
		t.Fatalf("StopMachine(force=true) = (%+v, %v)", stopOp, err)
	}
	graceStop, err := c.StopMachine(ctx, "m_1", false)
	if err != nil || graceStop.Phase != "graceful" {
		t.Fatalf("StopMachine(force=false) = (%+v, %v)", graceStop, err)
	}
	if _, err := c.SuspendMachine(ctx, "m_1"); err != nil {
		t.Fatalf("SuspendMachine error: %v", err)
	}
	if _, err := c.ResumeMachine(ctx, "m_1"); err != nil {
		t.Fatalf("ResumeMachine error: %v", err)
	}
	doneOp, err := c.GetOperation(ctx, "op_123", 10)
	if err != nil || doneOp.State != "succeeded" {
		t.Fatalf("GetOperation = (%+v, %v)", doneOp, err)
	}

	// 403 missing_scope
	_, err = c.StartMachine(ctx, "m_ro")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || !apiErr.IsMissingScope() {
		t.Fatalf("expected missing_scope APIError, got %v", err)
	}

	// 429 rate_limited
	_, err = c.StartMachine(ctx, "m_429")
	if !errors.As(err, &apiErr) || !apiErr.IsRateLimited() || apiErr.RetryAfter() != 45*time.Second {
		t.Fatalf("expected 429 RetryAfter 45s, got %v", err)
	}

	// 401 expired_key
	_, err = c.StartMachine(ctx, "m_401")
	if !errors.As(err, &apiErr) || !apiErr.IsAuthError() || apiErr.Code != "expired_key" {
		t.Fatalf("expected 401 expired_key, got %v", err)
	}
}
