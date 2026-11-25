package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"instabox-monitor/internal/instabox"
	"instabox-monitor/internal/poller"
	"instabox-monitor/internal/store"
)

type fleetMachineView struct {
	instabox.Machine
	AccountID      string                  `json:"accountId"`
	AccountName    string                  `json:"accountName"`
	AccountSource  string                  `json:"accountSource"`
	AccountStatus  string                  `json:"accountStatus"`
	OrgName        string                  `json:"orgName"`
	CanWrite       bool                    `json:"canWrite"`
	ReadOnly       bool                    `json:"readOnly"`
	LiveMetrics    *poller.VMLiveTelemetry `json:"liveMetrics,omitempty"`
	PortsCount     int                     `json:"portsCount"`
	SnapshotStale  bool                    `json:"snapshotStale"`
	SnapshotAt     *time.Time              `json:"snapshotAt,omitempty"`
}

type fleetSummary struct {
	TotalVMs            int `json:"totalVMs"`
	RunningVMs          int `json:"runningVMs"`
	SuspendedVMs        int `json:"suspendedVMs"`
	StoppedVMs          int `json:"stoppedVMs"`
	TransitioningVMs    int `json:"transitioningVMs"`
	ErrorVMs            int `json:"errorVMs"`
	TotalAccounts       int `json:"totalAccounts"`
	HealthyAccounts     int `json:"healthyAccounts"`
	DegradedAccounts    int `json:"degradedAccounts"`
	AutoDisabledAccount int `json:"autoDisabledAccounts"`
	KeyErrorAccounts    int `json:"keyErrorAccounts"`
	RunningVCPUs        int `json:"runningVCPUs"`
	RunningMemMiB       int `json:"runningMemMiB"`
	TotalVCPUs          int `json:"totalVCPUs"`
	TotalMemMiB         int `json:"totalMemMiB"`
	TotalDiskGiB        int `json:"totalDiskGiB"`
	AlertCount          int `json:"alertCount"`
	OOMAlertCount       int `json:"oomAlertCount"`
	DiskAlertCount      int `json:"diskAlertCount"`
	LockAlertCount      int `json:"lockAlertCount"`
	UnreachableCount    int `json:"unreachableCount"`
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	dbOK := s.store.Ping(r.Context()) == nil
	accounts, _ := s.store.ListAccounts(r.Context())
	healthy := 0
	for _, a := range accounts {
		if a.Enabled && a.LastSyncStatus == store.StatusOK {
			healthy++
		}
	}
	status := "ok"
	httpCode := http.StatusOK
	if !dbOK {
		status = "degraded"
		httpCode = http.StatusServiceUnavailable
	}
	writeJSON(w, httpCode, map[string]any{
		"status":          status,
		"version":         s.version,
		"appEnv":          s.cfg.AppEnv,
		"uptimeSeconds":   int64(time.Since(s.startedAt).Seconds()),
		"accountsTotal":   len(accounts),
		"accountsHealthy": healthy,
	})
}

func (s *Server) handleGetFleet(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.store.ListAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	snaps := s.poller.SnapshotCopy()

	accViews := make([]accountResponse, 0, len(accounts))
	machines := make([]fleetMachineView, 0)
	var summary fleetSummary
	summary.TotalAccounts = len(accounts)

	staleThreshold := s.cfg.PollInterval() * 3
	now := time.Now().UTC()

	for _, acc := range accounts {
		snap, hasSnap := snaps[acc.ID]
		var snapPtr *poller.AccountCache
		if hasSnap {
			snapPtr = &snap
		}
		av := s.toAccountResponseWithSnapshot(acc, snapPtr)
		accViews = append(accViews, av)

		switch acc.LastSyncStatus {
		case store.StatusOK:
			if acc.Enabled {
				summary.HealthyAccounts++
			}
		case store.StatusAutoDisabled:
			summary.AutoDisabledAccount++
			summary.DegradedAccounts++
		case store.StatusKeyError:
			summary.KeyErrorAccounts++
			summary.DegradedAccounts++
		default:
			if acc.Enabled && acc.LastSyncStatus != store.StatusPending {
				summary.DegradedAccounts++
			}
		}

		orgNames := make(map[string]string, len(av.Orgs))
		for _, o := range av.Orgs {
			orgNames[o.ID] = o.Name
		}

		if !hasSnap {
			continue
		}

		portCountByVM := make(map[string]int)
		for _, p := range snap.Ports {
			portCountByVM[p.MachineID]++
		}
		var snapAt *time.Time
		stale := false
		if !snap.FetchedAt.IsZero() {
			t := snap.FetchedAt
			snapAt = &t
			stale = now.Sub(snap.FetchedAt) > staleThreshold || acc.LastSyncStatus != store.StatusOK
		}

		for _, vm := range snap.Machines {
			summary.TotalVMs++
			summary.TotalVCPUs += vm.Spec.VCPUs
			summary.TotalMemMiB += vm.Spec.MemMiB
			if vm.Storage != nil {
				summary.TotalDiskGiB += vm.Storage.SizeGiB
			} else if vm.Spec.PersistentDiskGiB > 0 {
				summary.TotalDiskGiB += vm.Spec.PersistentDiskGiB
			}

			switch vm.State {
			case "running":
				summary.RunningVMs++
				summary.RunningVCPUs += vm.Spec.VCPUs
				summary.RunningMemMiB += vm.Spec.MemMiB
			case "suspended":
				summary.SuspendedVMs++
			case "stopped":
				summary.StoppedVMs++
			case "error":
				summary.ErrorVMs++
			default:
				summary.TransitioningVMs++
			}

			var live *poller.VMLiveTelemetry
			if tel, ok := snap.LiveMetrics[vm.ID]; ok {
				cp := tel
				live = &cp
			}

			hasAlert := false
			if vm.OOMKills > 0 {
				summary.OOMAlertCount++
				hasAlert = true
			}
			if vm.AbuseLock != nil || vm.CooldownReason != "" {
				summary.LockAlertCount++
				hasAlert = true
			}
			if vm.Runtime != nil && vm.Runtime.HostUnreachable {
				summary.UnreachableCount++
				hasAlert = true
			}
			if live != nil && live.DiskWarning != nil && live.DiskWarning.Level != "" && live.DiskWarning.Level != "ok" {
				summary.DiskAlertCount++
				hasAlert = true
			} else if live != nil && (live.DiskLevel == "high" || live.DiskLevel == "critical" || live.DiskLevel == "full") {
				summary.DiskAlertCount++
				hasAlert = true
			}
			if hasAlert {
				summary.AlertCount++
			}

			orgName := orgNames[vm.OrgID]
			if orgName == "" {
				orgName = vm.OrgID
			}

			machines = append(machines, fleetMachineView{
				Machine:       vm,
				AccountID:     acc.ID,
				AccountName:   acc.Name,
				AccountSource: acc.Source,
				AccountStatus: acc.LastSyncStatus,
				OrgName:       orgName,
				CanWrite:      acc.CanWrite(),
				ReadOnly:      acc.ReadOnly,
				LiveMetrics:   live,
				PortsCount:    portCountByVM[vm.ID],
				SnapshotStale: stale,
				SnapshotAt:    snapAt,
			})
		}
	}

	sort.Slice(machines, func(i, j int) bool {
		if machines[i].AccountName != machines[j].AccountName {
			return machines[i].AccountName < machines[j].AccountName
		}
		return machines[i].Name < machines[j].Name
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"summary":                   summary,
		"accounts":                  accViews,
		"machines":                  machines,
		"pollIntervalSeconds":       s.cfg.PollIntervalSeconds,
		"metricsPollIntervalSeconds": s.cfg.MetricsPollIntervalSeconds,
		"generatedAt":               now,
	})
}

type wakeAllTarget struct {
	account store.Account
	machine instabox.Machine
	action  string // "start" | "resume"
}

type wakeAllResultItem struct {
	AccountID   string `json:"accountId"`
	AccountName string `json:"accountName"`
	MachineID   string `json:"machineId"`
	MachineName string `json:"machineName"`
	Action      string `json:"action"`
	OperationID string `json:"operationId,omitempty"`
	Status      string `json:"status"` // triggered, skipped, failed
	Error       string `json:"error,omitempty"`
}

func (s *Server) handleWakeAll(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AccountID  string   `json:"accountId"`
		OrgID      string   `json:"orgId"`
		Search     string   `json:"search"`
		MachineIDs []string `json:"machineIds"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON payload")
		return
	}

	accounts, err := s.store.ListAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	snaps := s.poller.SnapshotCopy()

	idFilter := make(map[string]struct{}, len(req.MachineIDs))
	for _, id := range req.MachineIDs {
		idFilter[id] = struct{}{}
	}
	searchLower := strings.ToLower(strings.TrimSpace(req.Search))

	var targets []wakeAllTarget
	var results []wakeAllResultItem
	skipped := 0

	for _, acc := range accounts {
		if req.AccountID != "" && acc.ID != req.AccountID {
			continue
		}
		snap, ok := snaps[acc.ID]
		if !ok {
			continue
		}
		for _, vm := range snap.Machines {
			if req.OrgID != "" && vm.OrgID != req.OrgID {
				continue
			}
			if len(idFilter) > 0 {
				if _, match := idFilter[vm.ID]; !match {
					continue
				}
			}
			if searchLower != "" && !matchesMachineSearch(vm, searchLower) {
				continue
			}

			var action string
			switch vm.State {
			case "stopped":
				action = "start"
			case "suspended":
				action = "resume"
			default:
				// Already running, transitioning, or error -> skip
				continue
			}

			if !acc.CanWrite() {
				skipped++
				reason := "account is read-only or disabled"
				if acc.LastSyncStatus == store.StatusAutoDisabled {
					reason = "account auto-disabled (401)"
				} else if acc.LastSyncStatus == store.StatusKeyError {
					reason = "account key_error"
				}
				results = append(results, wakeAllResultItem{
					AccountID:   acc.ID,
					AccountName: acc.Name,
					MachineID:   vm.ID,
					MachineName: vm.Name,
					Action:      action,
					Status:      "skipped",
					Error:       reason,
				})
				continue
			}
			targets = append(targets, wakeAllTarget{account: acc, machine: vm, action: action})
		}
	}

	// Execute wake actions with bounded concurrency (max 4 concurrent per account).
	byAccount := make(map[string][]wakeAllTarget)
	for _, t := range targets {
		byAccount[t.account.ID] = append(byAccount[t.account.ID], t)
	}

	var resMu sync.Mutex
	var triggered, failed int
	var accWG sync.WaitGroup

	for accountID, accTargets := range byAccount {
		accountID, accTargets := accountID, accTargets
		accWG.Add(1)
		go func() {
			defer accWG.Done()
			client, _, cErr := s.poller.ClientForAccount(r.Context(), accountID)
			if cErr != nil {
				resMu.Lock()
				for _, t := range accTargets {
					failed++
					results = append(results, wakeAllResultItem{
						AccountID: t.account.ID, AccountName: t.account.Name,
						MachineID: t.machine.ID, MachineName: t.machine.Name,
						Action: t.action, Status: "failed", Error: cErr.Error(),
					})
				}
				resMu.Unlock()
				return
			}

			sem := make(chan struct{}, 4)
			var vmWG sync.WaitGroup
			for _, t := range accTargets {
				t := t
				vmWG.Add(1)
				go func() {
					defer vmWG.Done()
					sem <- struct{}{}
					defer func() { <-sem }()

					var (
						op  instabox.Operation
						err error
					)
					if t.action == "resume" {
						op, err = client.ResumeMachine(r.Context(), t.machine.ID)
					} else {
						op, err = client.StartMachine(r.Context(), t.machine.ID)
					}

					resMu.Lock()
					defer resMu.Unlock()
					if err != nil {
						var apiErr *instabox.APIError
						if err != nil && isMissingScopeErr(err, &apiErr) {
							_ = s.store.SetAccountWriteCapable(context.Background(), t.account.ID, false)
						}
						failed++
						results = append(results, wakeAllResultItem{
							AccountID: t.account.ID, AccountName: t.account.Name,
							MachineID: t.machine.ID, MachineName: t.machine.Name,
							Action: t.action, Status: "failed", Error: err.Error(),
						})
						return
					}
					triggered++
					results = append(results, wakeAllResultItem{
						AccountID: t.account.ID, AccountName: t.account.Name,
						MachineID: t.machine.ID, MachineName: t.machine.Name,
						Action: t.action, OperationID: op.ID, Status: "triggered",
					})
					if op.ID != "" {
						s.poller.TrackOperation(t.account.ID, t.machine.ID, t.machine.Name, op)
					}
				}()
			}
			vmWG.Wait()
		}()
	}
	accWG.Wait()

	if triggered > 0 || failed > 0 {
		_ = s.store.AddActivityEvent(r.Context(), store.ActivityEvent{
			AccountID: req.AccountID,
			EventType: "bulk_wake",
			Detail:    fmt.Sprintf("Wake All triggered=%d skipped=%d failed=%d", triggered, skipped, failed),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"total":     len(targets) + skipped,
		"triggered": triggered,
		"skipped":   skipped,
		"failed":    failed,
		"results":   results,
	})
}

func matchesMachineSearch(vm instabox.Machine, q string) bool {
	if strings.Contains(strings.ToLower(vm.Name), q) || strings.Contains(strings.ToLower(vm.ID), q) {
		return true
	}
	if vm.Template != nil && strings.Contains(strings.ToLower(vm.Template.ID), q) {
		return true
	}
	for k, v := range vm.Metadata {
		if strings.Contains(strings.ToLower(k+"="+v), q) {
			return true
		}
	}
	return false
}

func (s *Server) handleListActivity(w http.ResponseWriter, r *http.Request) {
	events, err := s.store.ListActivityEvents(r.Context(), 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if events == nil {
		events = []store.ActivityEvent{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "sse_unsupported", "streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, unsub := s.poller.Broker().Subscribe()
	defer unsub()

	// Send initial connected event
	initPayload, _ := json.Marshal(poller.Event{Type: "connected", Timestamp: time.Now().UTC()})
	_, _ = fmt.Fprintf(w, "event: message\ndata: %s\n\n", initPayload)
	flusher.Flush()

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case msg, open := <-ch:
			if !open {
				return
			}
			_, _ = fmt.Fprintf(w, "event: message\ndata: %s\n\n", msg)
			flusher.Flush()
		}
	}
}
