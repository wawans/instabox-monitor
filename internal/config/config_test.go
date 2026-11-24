package config

import (
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	keys := []string{
		"PORT", "APP_ENV", "LOG_DIR", "DATA_DIR", "APP_KEY",
		"APP_USERNAME", "APP_PASSWORD", "COOKIE_SECURE",
		"POLL_INTERVAL_SECONDS", "METRICS_POLL_INTERVAL_SECONDS",
		"ACCOUNT_MAX_AUTH_FAILURES", "INSTABOX_ACCOUNTS_JSON",
		"INSTABOX_ACCOUNTS_FILE", "ACCOUNTS_SEED_MODE",
	}
	for _, k := range keys {
		t.Setenv(k, "")
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want 8080", cfg.Port)
	}
	if cfg.IsDebug() {
		t.Errorf("IsDebug() = true, want false")
	}
	if cfg.AuthEnabled() {
		t.Errorf("AuthEnabled() = true, want false")
	}
	if cfg.AppUsername != "admin" {
		t.Errorf("AppUsername = %q, want admin", cfg.AppUsername)
	}
	if cfg.PollInterval() != 15*time.Second {
		t.Errorf("PollInterval = %v, want 15s", cfg.PollInterval())
	}
	if cfg.MetricsPollInterval() != 30*time.Second {
		t.Errorf("MetricsPollInterval = %v, want 30s", cfg.MetricsPollInterval())
	}
	if cfg.AccountMaxAuthFailures != 3 {
		t.Errorf("AccountMaxAuthFailures = %d, want 3", cfg.AccountMaxAuthFailures)
	}
	if cfg.AccountsSeedMode != SeedModeSync {
		t.Errorf("AccountsSeedMode = %q, want sync", cfg.AccountsSeedMode)
	}
}

func TestLoadCustomAndClamping(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("APP_ENV", "debug")
	t.Setenv("APP_KEY", "test-secret-key")
	t.Setenv("APP_USERNAME", "ops")
	t.Setenv("APP_PASSWORD", "s3cret")
	t.Setenv("POLL_INTERVAL_SECONDS", "2")
	t.Setenv("METRICS_POLL_INTERVAL_SECONDS", "0")
	t.Setenv("ACCOUNT_MAX_AUTH_FAILURES", "5")
	t.Setenv("ACCOUNTS_SEED_MODE", "bootstrap")
	t.Setenv("COOKIE_SECURE", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if !cfg.IsDebug() {
		t.Errorf("IsDebug() = false, want true")
	}
	if !cfg.AuthEnabled() || cfg.AppUsername != "ops" {
		t.Errorf("Auth config mismatch: enabled=%v user=%q", cfg.AuthEnabled(), cfg.AppUsername)
	}
	if cfg.PollIntervalSeconds != 5 {
		t.Errorf("PollIntervalSeconds = %d, want clamped 5", cfg.PollIntervalSeconds)
	}
	if cfg.MetricsPollInterval() != 0 {
		t.Errorf("MetricsPollInterval = %v, want 0", cfg.MetricsPollInterval())
	}
	if cfg.AccountMaxAuthFailures != 5 {
		t.Errorf("AccountMaxAuthFailures = %d, want 5", cfg.AccountMaxAuthFailures)
	}
	if cfg.AccountsSeedMode != SeedModeBootstrap {
		t.Errorf("AccountsSeedMode = %q, want bootstrap", cfg.AccountsSeedMode)
	}
}

func TestLoadValidationErrors(t *testing.T) {
	t.Setenv("ACCOUNTS_SEED_MODE", "invalid_mode")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for invalid ACCOUNTS_SEED_MODE")
	}
	t.Setenv("ACCOUNTS_SEED_MODE", "sync")
	t.Setenv("COOKIE_SECURE", "maybe")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for invalid COOKIE_SECURE")
	}
}
