package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"instabox-monitor/internal/config"
	"instabox-monitor/internal/crypto"
	"instabox-monitor/internal/instabox"
	"instabox-monitor/internal/poller"
	"instabox-monitor/internal/store"
)

// Server wires HTTP handlers for the dashboard REST API, SSE stream, and embedded Web UI.
type Server struct {
	cfg       config.Config
	store     *store.Store
	cipher    *crypto.Cipher
	poller    *poller.Manager
	log       *slog.Logger
	version   string
	startedAt time.Time
	limiter   *loginRateLimiter
	mux       *http.ServeMux
}

// NewServer constructs the HTTP Server with all API routes and optional static UI handler.
func NewServer(cfg config.Config, st *store.Store, ciph *crypto.Cipher, pm *poller.Manager, log *slog.Logger, version string, uiHandler http.Handler) *Server {
	if log == nil {
		log = slog.Default()
	}
	if version == "" {
		version = "dev"
	}
	s := &Server{
		cfg:       cfg,
		store:     st,
		cipher:    ciph,
		poller:    pm,
		log:       log,
		version:   version,
		startedAt: time.Now().UTC(),
		limiter:   newLoginRateLimiter(),
		mux:       http.NewServeMux(),
	}
	s.registerRoutes(uiHandler)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) registerRoutes(uiHandler http.Handler) {
	// Public routes
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	s.mux.HandleFunc("POST /api/auth/login", s.handleAuthLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.handleAuthLogout)

	// Protected API routes (middleware enforces session only when APP_PASSWORD is set)
	protect := s.requireAuth

	// Accounts
	s.mux.Handle("GET /api/accounts", protect(http.HandlerFunc(s.handleListAccounts)))
	s.mux.Handle("POST /api/accounts", protect(http.HandlerFunc(s.handleCreateAccount)))
	s.mux.Handle("POST /api/accounts/bulk", protect(http.HandlerFunc(s.handleBulkCreateAccounts)))
	s.mux.Handle("POST /api/accounts/test", protect(http.HandlerFunc(s.handleTestAccount)))
	s.mux.Handle("PATCH /api/accounts/{id}", protect(http.HandlerFunc(s.handleUpdateAccount)))
	s.mux.Handle("DELETE /api/accounts/{id}", protect(http.HandlerFunc(s.handleDeleteAccount)))
	s.mux.Handle("POST /api/accounts/{id}/sync", protect(http.HandlerFunc(s.handleSyncAccount)))

	// Fleet, Ports, Activity, SSE
	s.mux.Handle("GET /api/fleet", protect(http.HandlerFunc(s.handleGetFleet)))
	s.mux.Handle("POST /api/fleet/sync", protect(http.HandlerFunc(s.handleSyncAll)))
	s.mux.Handle("POST /api/fleet/wake-all", protect(http.HandlerFunc(s.handleWakeAll)))
	s.mux.Handle("GET /api/ports", protect(http.HandlerFunc(s.handleListPorts)))
	s.mux.Handle("GET /api/activity", protect(http.HandlerFunc(s.handleListActivity)))
	s.mux.Handle("GET /api/events", protect(http.HandlerFunc(s.handleSSE)))

	// VM Detail, Lifecycle & Port Publishing
	s.mux.Handle("GET /api/accounts/{accountId}/vms/{machineId}", protect(http.HandlerFunc(s.handleGetVM)))
	s.mux.Handle("GET /api/accounts/{accountId}/vms/{machineId}/metrics", protect(http.HandlerFunc(s.handleGetVMMetrics)))
	s.mux.Handle("GET /api/accounts/{accountId}/vms/{machineId}/disk", protect(http.HandlerFunc(s.handleGetVMDisk)))
	s.mux.Handle("GET /api/accounts/{accountId}/vms/{machineId}/processes", protect(http.HandlerFunc(s.handleGetVMProcesses)))
	s.mux.Handle("GET /api/accounts/{accountId}/vms/{machineId}/logs", protect(http.HandlerFunc(s.handleGetVMLogs)))
	s.mux.Handle("POST /api/accounts/{accountId}/vms/{machineId}/actions/{action}", protect(http.HandlerFunc(s.handleVMAction)))
	s.mux.Handle("GET /api/accounts/{accountId}/vms/{machineId}/ports", protect(http.HandlerFunc(s.handleListMachinePorts)))
	s.mux.Handle("POST /api/accounts/{accountId}/vms/{machineId}/ports", protect(http.HandlerFunc(s.handlePublishPort)))
	s.mux.Handle("DELETE /api/accounts/{accountId}/vms/{machineId}/ports/{port}", protect(http.HandlerFunc(s.handleUnpublishPort)))
	s.mux.Handle("GET /api/accounts/{accountId}/operations/{opId}", protect(http.HandlerFunc(s.handleGetOperation)))

	// Embedded Web UI fallback
	if uiHandler != nil {
		s.mux.Handle("/", uiHandler)
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
}

func writeUpstreamError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "resource not found")
		return
	}
	if errors.Is(err, poller.ErrKeyMismatch) {
		writeError(w, http.StatusConflict, "key_error", err.Error())
		return
	}
	var apiErr *instabox.APIError
	if errors.As(err, &apiErr) {
		status := apiErr.StatusCode
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		writeJSON(w, status, map[string]any{
			"error": apiErr,
		})
		return
	}
	writeError(w, http.StatusBadGateway, "upstream_error", err.Error())
}

func decodeJSON(r *http.Request, dest any) error {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20)) // 2 MiB max request body
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, dest)
}
