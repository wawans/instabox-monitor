package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"instabox-monitor/internal/store"
)

const (
	sessionCookieName = "instabox_monitor_session"
	sessionTTL        = 7 * 24 * time.Hour
)

type loginRateLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
}

func newLoginRateLimiter() *loginRateLimiter {
	return &loginRateLimiter{attempts: make(map[string][]time.Time)}
}

func (l *loginRateLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	var kept []time.Time
	for _, ts := range l.attempts[ip] {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	l.attempts[ip] = kept
	return len(kept) < 10
}

func (l *loginRateLimiter) recordFailure(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.attempts[ip] = append(l.attempts[ip], time.Now())
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.cfg.AuthEnabled() {
			next.ServeHTTP(w, r)
			return
		}
		if _, ok := s.currentSession(r); !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) currentSession(r *http.Request) (store.Session, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return store.Session{}, false
	}
	sess, err := s.store.GetSession(r.Context(), hashToken(cookie.Value))
	if err != nil {
		return store.Session{}, false
	}
	return sess, true
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.AuthEnabled() {
		writeJSON(w, http.StatusOK, map[string]any{
			"authEnabled":   false,
			"authenticated": true,
			"username":      "",
		})
		return
	}
	sess, ok := s.currentSession(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"authEnabled":   true,
		"authenticated": ok,
		"username":      sess.Username,
	})
}

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.AuthEnabled() {
		writeJSON(w, http.StatusOK, map[string]any{
			"authEnabled":   false,
			"authenticated": true,
		})
		return
	}

	ip := clientIP(r)
	if !s.limiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many failed login attempts; try again in 1 minute")
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON payload")
		return
	}

	userOK := subtle.ConstantTimeCompare([]byte(req.Username), []byte(s.cfg.AppUsername)) == 1
	passOK := subtle.ConstantTimeCompare([]byte(req.Password), []byte(s.cfg.AppPassword)) == 1
	if !userOK || !passOK {
		s.limiter.recordFailure(ip)
		s.log.Warn("failed dashboard login attempt", "ip", ip, "username", req.Username)
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid username or password")
		return
	}

	rawTok := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, rawTok); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "failed to generate session token")
		return
	}
	tokHex := hex.EncodeToString(rawTok)
	expires := time.Now().UTC().Add(sessionTTL)

	if err := s.store.CreateSession(r.Context(), store.Session{
		TokenHash: hashToken(tokHex),
		Username:  s.cfg.AppUsername,
		ExpiresAt: expires,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "failed to create session")
		return
	}
	_ = s.store.PurgeExpiredSessions(r.Context())

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    tokHex,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.isCookieSecure(r),
		Expires:  expires,
		MaxAge:   int(sessionTTL.Seconds()),
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"authEnabled":   true,
		"authenticated": true,
		"username":      s.cfg.AppUsername,
	})
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil && cookie.Value != "" {
		_ = s.store.DeleteSession(r.Context(), hashToken(cookie.Value))
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.isCookieSecure(r),
		MaxAge:   -1,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) isCookieSecure(r *http.Request) bool {
	switch s.cfg.CookieSecure {
	case "true":
		return true
	case "false":
		return false
	default:
		if r.TLS != nil {
			return true
		}
		return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	}
}

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		if idx := strings.IndexByte(xff, ','); idx > 0 {
			return strings.TrimSpace(xff[:idx])
		}
		return xff
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
