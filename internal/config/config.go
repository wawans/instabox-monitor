package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	SeedModeSync      = "sync"
	SeedModeBootstrap = "bootstrap"
)

// Config holds runtime configuration parsed from environment variables.
type Config struct {
	Port                       int
	AppEnv                     string
	LogDir                     string
	DataDir                    string
	AppKey                     string
	AppUsername                string
	AppPassword                string
	CookieSecure               string // "auto", "true", "false"
	PollIntervalSeconds        int
	MetricsPollIntervalSeconds int
	AccountMaxAuthFailures     int
	AccountsJSON               string
	AccountsFile               string
	AccountsSeedMode           string // "sync" or "bootstrap"
}

// IsDebug reports whether the application runs in DEBUG mode.
func (c Config) IsDebug() bool {
	return strings.EqualFold(strings.TrimSpace(c.AppEnv), "DEBUG")
}

// AuthEnabled reports whether optional dashboard login is active.
func (c Config) AuthEnabled() bool {
	return strings.TrimSpace(c.AppPassword) != ""
}

// PollInterval returns the fleet polling duration.
func (c Config) PollInterval() time.Duration {
	return time.Duration(c.PollIntervalSeconds) * time.Second
}

// MetricsPollInterval returns the tiered metrics polling duration (0 = disabled).
func (c Config) MetricsPollInterval() time.Duration {
	if c.MetricsPollIntervalSeconds <= 0 {
		return 0
	}
	return time.Duration(c.MetricsPollIntervalSeconds) * time.Second
}

// Load reads Config from environment variables with safe defaults.
func Load() (Config, error) {
	cfg := Config{
		Port:                       envInt("PORT", 8080),
		AppEnv:                     envString("APP_ENV", "production"),
		LogDir:                     envString("LOG_DIR", "logs"),
		DataDir:                    envString("DATA_DIR", "./data"),
		AppKey:                     strings.TrimSpace(os.Getenv("APP_KEY")),
		AppUsername:                envString("APP_USERNAME", "admin"),
		AppPassword:                os.Getenv("APP_PASSWORD"),
		CookieSecure:               strings.ToLower(envString("COOKIE_SECURE", "auto")),
		PollIntervalSeconds:        envInt("POLL_INTERVAL_SECONDS", 15),
		MetricsPollIntervalSeconds: envInt("METRICS_POLL_INTERVAL_SECONDS", 30),
		AccountMaxAuthFailures:     envInt("ACCOUNT_MAX_AUTH_FAILURES", 3),
		AccountsJSON:               strings.TrimSpace(os.Getenv("INSTABOX_ACCOUNTS_JSON")),
		AccountsFile:               strings.TrimSpace(os.Getenv("INSTABOX_ACCOUNTS_FILE")),
		AccountsSeedMode:           strings.ToLower(envString("ACCOUNTS_SEED_MODE", SeedModeSync)),
	}

	if cfg.Port < 1 || cfg.Port > 65535 {
		return Config{}, fmt.Errorf("invalid PORT %d: must be 1-65535", cfg.Port)
	}
	if cfg.PollIntervalSeconds < 5 {
		cfg.PollIntervalSeconds = 5
	}
	if cfg.MetricsPollIntervalSeconds < 0 {
		cfg.MetricsPollIntervalSeconds = 0
	}
	if cfg.AccountMaxAuthFailures < 0 {
		cfg.AccountMaxAuthFailures = 0
	}
	switch cfg.CookieSecure {
	case "auto", "true", "false":
	default:
		return Config{}, fmt.Errorf("invalid COOKIE_SECURE %q: must be auto, true, or false", cfg.CookieSecure)
	}
	switch cfg.AccountsSeedMode {
	case SeedModeSync, SeedModeBootstrap:
	default:
		return Config{}, fmt.Errorf("invalid ACCOUNTS_SEED_MODE %q: must be sync or bootstrap", cfg.AccountsSeedMode)
	}
	return cfg, nil
}

func envString(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}
