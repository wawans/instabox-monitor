package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"instabox-monitor/internal/instabox"
	"instabox-monitor/internal/poller"
	"instabox-monitor/internal/store"
)

type portView struct {
	instabox.PublicPort
	AccountID    string `json:"accountId"`
	AccountName  string `json:"accountName"`
	OrgID        string `json:"orgId,omitempty"`
	OrgName      string `json:"orgName,omitempty"`
	MachineName  string `json:"machineName"`
	MachineState string `json:"machineState"`
	CanWrite     bool   `json:"canWrite"`
	ReadOnly     bool   `json:"readOnly"`
}

func (s *Server) handleListPorts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.store.ListAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	snaps := s.poller.SnapshotCopy()

	out := make([]portView, 0)
	for _, acc := range accounts {
		av := s.toAccountResponse(acc)
		snap, ok := snaps[acc.ID]
		if !ok {
			continue
		}

		orgNames := make(map[string]string, len(av.Orgs))
		for _, o := range av.Orgs {
			orgNames[o.ID] = o.Name
		}

		vmByID := make(map[string]instabox.Machine, len(snap.Machines))
		for _, vm := range snap.Machines {
			vmByID[vm.ID] = vm
		}

		for _, p := range snap.Ports {
			vm := vmByID[p.MachineID]
			out = append(out, portView{
				PublicPort:   poller.SanitizePublicPort(p),
				AccountID:    acc.ID,
				AccountName:  acc.Name,
				OrgID:        vm.OrgID,
				OrgName:      orgNames[vm.OrgID],
				MachineName:  vm.Name,
				MachineState: vm.State,
				CanWrite:     av.CanWrite,
				ReadOnly:     av.ReadOnly,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		aName := strings.ToLower(out[i].AccountName)
		bName := strings.ToLower(out[j].AccountName)
		if aName != bName {
			return aName < bName
		}
		if out[i].AccountID != out[j].AccountID {
			return out[i].AccountID < out[j].AccountID
		}
		mA := strings.ToLower(out[i].MachineName)
		mB := strings.ToLower(out[j].MachineName)
		if mA != mB {
			return mA < mB
		}
		if out[i].MachineID != out[j].MachineID {
			return out[i].MachineID < out[j].MachineID
		}
		return out[i].Port < out[j].Port
	})

	writeJSON(w, http.StatusOK, map[string]any{"ports": out})
}

func (s *Server) handleListMachinePorts(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")

	client, _, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}

	list, err := client.ListMachinePorts(r.Context(), machineID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}

	sanitized := make([]instabox.PublicPort, len(list.Ports))
	for i, p := range list.Ports {
		sanitized[i] = poller.SanitizePublicPort(p)
	}
	list.Ports = sanitized
	writeJSON(w, http.StatusOK, list)
}

type publishPortBody struct {
	Port        int    `json:"port"`
	Name        string `json:"name"`
	Protocol    string `json:"protocol"`
	Access      string `json:"access"`
	RotateToken bool   `json:"rotateToken"`
	MachineName string `json:"machineName"`
}

func (s *Server) handlePublishPort(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")

	client, acc, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	if !ensureAccountWritable(w, acc) {
		return
	}

	var body publishPortBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid JSON request body")
		return
	}

	req, errCode, errMsg := validatePublishPortBody(body)
	if errCode != "" {
		writeError(w, http.StatusBadRequest, errCode, errMsg)
		return
	}

	portObj, err := client.PublishPort(r.Context(), machineID, req)
	if err != nil {
		s.handlePortWriteError(w, acc, err)
		return
	}

	s.markAccountWriteCapable(acc)
	bgCtx := context.WithoutCancel(r.Context())
	s.poller.UpsertCachedPort(bgCtx, acc.ID, portObj)

	machineName := s.resolveMachineName(acc.ID, machineID, body.MachineName)
	detail := formatPortPublishActivity(req, portObj)
	_ = s.store.AddActivityEvent(bgCtx, store.ActivityEvent{
		AccountID:   acc.ID,
		MachineID:   machineID,
		MachineName: machineName,
		EventType:   "port_publish",
		Detail:      detail,
	})

	// Return the full one-time response directly (including Token / TokenURL if returned by upstream).
	// Cache, SQLite snapshots, and activity logs remain stripped of secrets.
	writeJSON(w, http.StatusOK, portObj)
}

func (s *Server) handleUnpublishPort(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("accountId")
	machineID := r.PathValue("machineId")
	portStr := r.PathValue("port")

	port, err := strconv.Atoi(strings.TrimSpace(portStr))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_port", "port must be a valid integer")
		return
	}
	if errCode, errMsg := validatePortNumber(port); errCode != "" {
		writeError(w, http.StatusBadRequest, errCode, errMsg)
		return
	}

	client, acc, err := s.poller.ClientForAccount(r.Context(), accountID)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	if !ensureAccountWritable(w, acc) {
		return
	}

	if err := client.UnpublishPort(r.Context(), machineID, port); err != nil {
		s.handlePortWriteError(w, acc, err)
		return
	}

	s.markAccountWriteCapable(acc)
	bgCtx := context.WithoutCancel(r.Context())
	s.poller.RemoveCachedPort(bgCtx, acc.ID, machineID, port)

	machineName := s.resolveMachineName(acc.ID, machineID, r.URL.Query().Get("machineName"))
	_ = s.store.AddActivityEvent(bgCtx, store.ActivityEvent{
		AccountID:   acc.ID,
		MachineID:   machineID,
		MachineName: machineName,
		EventType:   "port_unpublish",
		Detail:      fmt.Sprintf("Unpublished port %d", port),
	})

	w.WriteHeader(http.StatusNoContent)
}

func validatePortNumber(port int) (string, string) {
	if port < 1024 || port > 65535 {
		return "invalid_port", "port must be between 1024 and 65535"
	}
	if port == 5901 || port == 6768 {
		return "reserved_port", "ports 5901 (Desktop) and 6768 (Orca) are system-reserved"
	}
	return "", ""
}

func validatePublishPortBody(body publishPortBody) (instabox.PublishPortRequest, string, string) {
	if errCode, errMsg := validatePortNumber(body.Port); errCode != "" {
		return instabox.PublishPortRequest{}, errCode, errMsg
	}

	protocol := strings.ToLower(strings.TrimSpace(body.Protocol))
	if protocol == "" {
		protocol = "http"
	}
	if protocol != "http" && protocol != "tcp" {
		return instabox.PublishPortRequest{}, "invalid_protocol", "protocol must be http or tcp"
	}

	access := strings.ToLower(strings.TrimSpace(body.Access))
	if access == "" {
		access = "public"
	}
	if access != "public" && access != "private" {
		return instabox.PublishPortRequest{}, "invalid_access", "access must be public or private"
	}

	if protocol == "tcp" && access == "private" {
		return instabox.PublishPortRequest{}, "invalid_port_config", "TCP ports only support public access (TLS SNI routing)"
	}
	if body.RotateToken && access != "private" {
		return instabox.PublishPortRequest{}, "invalid_port_config", "rotateToken can only be requested for private access ports"
	}

	return instabox.PublishPortRequest{
		Port:        body.Port,
		Name:        strings.TrimSpace(body.Name),
		Protocol:    protocol,
		Access:      access,
		RotateToken: body.RotateToken,
	}, "", ""
}

func ensureAccountWritable(w http.ResponseWriter, acc store.Account) bool {
	if !acc.Enabled {
		writeError(w, http.StatusForbidden, "account_disabled", "account is disabled")
		return false
	}
	if acc.ReadOnly {
		writeError(w, http.StatusForbidden, "read_only_account", "account is configured as read-only")
		return false
	}
	return true
}

func (s *Server) handlePortWriteError(w http.ResponseWriter, acc store.Account, err error) {
	var apiErr *instabox.APIError
	if isMissingScopeErr(err, &apiErr) {
		_ = s.store.SetAccountWriteCapable(context.Background(), acc.ID, false)
		s.poller.Broker().Publish(poller.Event{Type: "account_updated", AccountID: acc.ID})
	}
	writeUpstreamError(w, err)
}

func (s *Server) markAccountWriteCapable(acc store.Account) {
	if acc.WriteCapable == nil || !*acc.WriteCapable {
		_ = s.store.SetAccountWriteCapable(context.Background(), acc.ID, true)
		s.poller.Broker().Publish(poller.Event{Type: "account_updated", AccountID: acc.ID})
	}
}

func (s *Server) resolveMachineName(accountID, machineID, explicit string) string {
	if trimmed := strings.TrimSpace(explicit); trimmed != "" {
		return trimmed
	}
	snaps := s.poller.SnapshotCopy()
	if snap, ok := snaps[accountID]; ok {
		for _, vm := range snap.Machines {
			if vm.ID == machineID && vm.Name != "" {
				return vm.Name
			}
		}
	}
	return machineID
}

func formatPortPublishActivity(req instabox.PublishPortRequest, res instabox.PublicPort) string {
	proto := res.Protocol
	if proto == "" {
		proto = req.Protocol
	}
	access := res.Access
	if access == "" {
		access = req.Access
	}
	name := res.Name
	if name == "" {
		name = req.Name
	}

	if req.RotateToken {
		return fmt.Sprintf("Rotated token for private port %d (%s)", res.Port, proto)
	}
	if name != "" {
		return fmt.Sprintf("Published port %d %q (%s, %s)", res.Port, name, proto, access)
	}
	return fmt.Sprintf("Published port %d (%s, %s)", res.Port, proto, access)
}
