package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"instabox-monitor/internal/instabox"
	"instabox-monitor/internal/poller"
	"instabox-monitor/internal/store"
)

func (s *Server) handleGetVM(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")

	client, acc, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}

	vm, err := client.GetMachine(r.Context(), machineID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}

	// Find ports for this machine from snapshot cache (or live fallback)
	var vmPorts []instabox.PublicPort
	snaps := s.poller.SnapshotCopy()
	if snap, ok := snaps[accountID]; ok {
		for _, p := range snap.Ports {
			if p.MachineID == machineID {
				vmPorts = append(vmPorts, p)
			}
		}
	}
	if vmPorts == nil {
		vmPorts = []instabox.PublicPort{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"account": s.toAccountResponse(acc),
		"machine": vm,
		"ports":   vmPorts,
	})
}

func (s *Server) handleGetVMMetrics(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")
	since := strings.TrimSpace(r.URL.Query().Get("since"))
	if since == "" {
		since = "1h"
	}
	resolvedSince, err := instabox.NormalizeMetricsSince(since, time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_since", err.Error())
		return
	}

	client, _, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	metrics, err := client.GetMachineMetrics(r.Context(), machineID, resolvedSince)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	if metrics.Metrics == nil {
		metrics.Metrics = []instabox.MachineMetric{}
	}
	writeJSON(w, http.StatusOK, metrics)
}

func (s *Server) handleGetVMDisk(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")

	client, _, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	disk, err := client.GetMachineDisk(r.Context(), machineID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	if disk.Filesystems == nil {
		disk.Filesystems = []instabox.MachineFilesystem{}
	}
	writeJSON(w, http.StatusOK, disk)
}

func (s *Server) handleGetVMProcesses(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")

	client, _, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	procs, err := client.GetMachineProcesses(r.Context(), machineID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	if procs.Processes == nil {
		procs.Processes = []instabox.Process{}
	}
	writeJSON(w, http.StatusOK, procs)
}

func (s *Server) handleGetVMLogs(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")

	tail := 200
	if rawTail := r.URL.Query().Get("tail"); rawTail != "" {
		if n, err := strconv.Atoi(rawTail); err == nil && n > 0 && n <= 2000 {
			tail = n
		}
	}
	var after int64
	if rawAfter := r.URL.Query().Get("after"); rawAfter != "" {
		if n, err := strconv.ParseInt(rawAfter, 10, 64); err == nil && n > 0 {
			after = n
		}
	}

	client, _, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	logs, err := client.GetMachineLogs(r.Context(), machineID, tail, after)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	if logs.Operations == nil {
		logs.Operations = []instabox.Operation{}
	}
	writeJSON(w, http.StatusOK, logs)
}

func (s *Server) handleVMAction(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")
	action := strings.ToLower(strings.TrimSpace(r.PathValue("action")))

	switch action {
	case "start", "stop", "suspend", "resume":
	default:
		writeError(w, http.StatusBadRequest, "invalid_action", "supported lifecycle actions are start, stop, suspend, resume")
		return
	}

	client, acc, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	if !acc.Enabled {
		writeError(w, http.StatusForbidden, "account_disabled", "account is disabled")
		return
	}
	if acc.ReadOnly {
		writeError(w, http.StatusForbidden, "read_only_account", "account is configured as read-only")
		return
	}

	var req struct {
		Force       bool   `json:"force"`
		MachineName string `json:"machineName"`
	}
	_ = decodeJSON(r, &req)

	var op instabox.Operation
	switch action {
	case "start":
		op, err = client.StartMachine(r.Context(), machineID)
	case "stop":
		op, err = client.StopMachine(r.Context(), machineID, req.Force)
	case "suspend":
		op, err = client.SuspendMachine(r.Context(), machineID)
	case "resume":
		op, err = client.ResumeMachine(r.Context(), machineID)
	}

	if err != nil {
		var apiErr *instabox.APIError
		if isMissingScopeErr(err, &apiErr) {
			_ = s.store.SetAccountWriteCapable(context.Background(), acc.ID, false)
			s.poller.Broker().Publish(poller.Event{Type: "account_updated", AccountID: acc.ID})
		}
		writeUpstreamError(w, err)
		return
	}

	if acc.WriteCapable == nil || !*acc.WriteCapable {
		_ = s.store.SetAccountWriteCapable(context.Background(), acc.ID, true)
	}

	detail := fmt.Sprintf("Requested %s on %s", action, machineID)
	if action == "stop" && req.Force {
		detail = fmt.Sprintf("Requested force stop (now=true) on %s", machineID)
	}
	_ = s.store.AddActivityEvent(r.Context(), store.ActivityEvent{
		AccountID:   acc.ID,
		MachineID:   machineID,
		MachineName: req.MachineName,
		EventType:   "lifecycle",
		Detail:      detail,
	})

	if op.ID != "" {
		s.poller.TrackOperation(acc.ID, machineID, req.MachineName, op)
	} else {
		s.poller.SyncNow(acc.ID)
	}

	writeJSON(w, http.StatusAccepted, op)
}

func (s *Server) handleGetOperation(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	opID := r.PathValue("opId")

	client, _, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	op, err := client.GetOperation(r.Context(), opID, 0)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, op)
}

func isMissingScopeErr(err error, out **instabox.APIError) bool {
	var apiErr *instabox.APIError
	if errors.As(err, &apiErr) && apiErr.IsMissingScope() {
		if out != nil {
			*out = apiErr
		}
		return true
	}
	return false
}
