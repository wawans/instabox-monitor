package config

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"

	"instabox-monitor/internal/crypto"
	"instabox-monitor/internal/store"
)

// SeedAccount defines a single account entry in INSTABOX_ACCOUNTS_JSON or INSTABOX_ACCOUNTS_FILE.
type SeedAccount struct {
	Slug     string `json:"slug" yaml:"slug"`
	Name     string `json:"name" yaml:"name"`
	APIKey   string `json:"apiKey" yaml:"apiKey"`
	BaseURL  string `json:"baseUrl" yaml:"baseUrl"`
	ReadOnly bool   `json:"readOnly" yaml:"readOnly"`
	Enabled  *bool  `json:"enabled" yaml:"enabled"`
}

type seedFileWrapper struct {
	Accounts []SeedAccount `json:"accounts" yaml:"accounts"`
}

// SeedResult summarizes actions taken by SeedAccounts.
type SeedResult struct {
	Created int
	Updated int
	Skipped int
}

var nonSlugRe = regexp.MustCompile(`[^a-z0-9-]+`)

// NormalizeSlug converts an arbitrary label into a clean lowercase slug.
func NormalizeSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "_", "-")
	s = strings.ReplaceAll(s, " ", "-")
	s = nonSlugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}

// ParseSeedAccounts loads seed accounts from cfg.AccountsFile and/or cfg.AccountsJSON.
func ParseSeedAccounts(cfg Config) ([]SeedAccount, error) {
	var all []SeedAccount

	if cfg.AccountsFile != "" {
		b, err := os.ReadFile(cfg.AccountsFile)
		if err != nil {
			return nil, fmt.Errorf("read INSTABOX_ACCOUNTS_FILE %s: %w", cfg.AccountsFile, err)
		}
		items, err := parseSeedBytes(b)
		if err != nil {
			return nil, fmt.Errorf("parse INSTABOX_ACCOUNTS_FILE %s: %w", cfg.AccountsFile, err)
		}
		all = append(all, items...)
	}

	if cfg.AccountsJSON != "" {
		items, err := parseSeedBytes([]byte(cfg.AccountsJSON))
		if err != nil {
			return nil, fmt.Errorf("parse INSTABOX_ACCOUNTS_JSON: %w", err)
		}
		all = append(all, items...)
	}

	return all, nil
}

func parseSeedBytes(raw []byte) ([]SeedAccount, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, nil
	}
	// Try JSON/YAML wrapper object: {"accounts": [...]} or accounts: [...]
	var wrapper seedFileWrapper
	if err := yaml.Unmarshal(raw, &wrapper); err == nil && len(wrapper.Accounts) > 0 {
		return wrapper.Accounts, nil
	}
	// Try bare array
	var list []SeedAccount
	if err := yaml.Unmarshal(raw, &list); err == nil {
		return list, nil
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	return list, nil
}

// SeedAccounts applies hybrid seeding rules using source ('seed' vs 'ui') and cfg.AccountsSeedMode.
func SeedAccounts(ctx context.Context, cfg Config, st *store.Store, ciph *crypto.Cipher, log *slog.Logger) (SeedResult, error) {
	var res SeedResult
	items, err := ParseSeedAccounts(cfg)
	if err != nil {
		return res, err
	}
	if len(items) == 0 {
		return res, nil
	}

	for i, item := range items {
		apiKey := strings.TrimSpace(item.APIKey)
		if apiKey == "" {
			if log != nil {
				log.Warn("skipping seed account with empty apiKey", "index", i, "name", item.Name)
			}
			res.Skipped++
			continue
		}
		name := strings.TrimSpace(item.Name)
		slug := NormalizeSlug(item.Slug)
		if slug == "" {
			slug = NormalizeSlug(name)
		}
		if slug == "" {
			slug = fmt.Sprintf("seed-%d", i+1)
		}
		if name == "" {
			name = slug
		}
		baseURL := strings.TrimRight(strings.TrimSpace(item.BaseURL), "/")
		if baseURL == "" {
			baseURL = "https://api.instabox.sh"
		}
		desiredEnabled := true
		if item.Enabled != nil {
			desiredEnabled = *item.Enabled
		}

		newHash := ciph.HashAPIKey(apiKey)

		existing, err := st.GetAccountBySlug(ctx, slug)
		if errors.Is(err, store.ErrNotFound) {
			// Skip if exact same API key already exists under another account (e.g. UI-added).
			if _, hashErr := st.FindAccountByAPIKeyHash(ctx, newHash); hashErr == nil {
				if log != nil {
					log.Info("skipping seed account whose API key already exists", "slug", slug)
				}
				res.Skipped++
				continue
			}

			enc, encErr := ciph.Encrypt(apiKey)
			if encErr != nil {
				return res, fmt.Errorf("encrypt seed account %s: %w", slug, encErr)
			}
			_, createErr := st.CreateAccount(ctx, store.Account{
				ID:             uuid.NewString(),
				Slug:           slug,
				Name:           name,
				BaseURL:        baseURL,
				APIKeyEnc:      enc,
				APIKeyHash:     newHash,
				KeyHint:        crypto.MaskAPIKey(apiKey),
				Enabled:        desiredEnabled,
				ReadOnly:       item.ReadOnly,
				Source:         store.SourceSeed,
				LastSyncStatus: store.StatusPending,
			})
			if createErr != nil {
				return res, fmt.Errorf("create seed account %s: %w", slug, createErr)
			}
			res.Created++
			continue
		}
		if err != nil {
			return res, fmt.Errorf("lookup seed account %s: %w", slug, err)
		}

		// Protect UI-managed accounts unconditionally.
		if existing.Source == store.SourceUI {
			if log != nil {
				log.Warn("skipping seed update because slug belongs to a UI-managed account", "slug", slug)
			}
			res.Skipped++
			continue
		}

		// Bootstrap mode: INSERT IF NOT EXISTS only (DB wins once present).
		if cfg.AccountsSeedMode == SeedModeBootstrap {
			res.Skipped++
			continue
		}

		// Sync mode: update seed account from config.
		_, decErr := ciph.Decrypt(existing.APIKeyEnc)
		keyChanged := decErr != nil || existing.APIKeyHash != newHash

		updated := existing
		updated.Name = name
		updated.BaseURL = baseURL
		updated.ReadOnly = item.ReadOnly

		if keyChanged {
			enc, encErr := ciph.Encrypt(apiKey)
			if encErr != nil {
				return res, fmt.Errorf("re-encrypt seed account %s: %w", slug, encErr)
			}
			updated.APIKeyEnc = enc
			updated.APIKeyHash = newHash
			updated.KeyHint = crypto.MaskAPIKey(apiKey)
			updated.WriteCapable = nil
			updated.ConsecutiveAuthFailures = 0
			updated.DisabledReason = ""
			updated.LastError = ""
			if updated.LastSyncStatus == store.StatusAutoDisabled || updated.LastSyncStatus == store.StatusKeyError || updated.LastSyncStatus == store.StatusAuthError {
				updated.LastSyncStatus = store.StatusPending
			}
			updated.Enabled = desiredEnabled
		} else {
			// Respect auto_disabled when API key has NOT changed to avoid 401 retry loops on restart.
			if existing.LastSyncStatus != store.StatusAutoDisabled {
				updated.Enabled = desiredEnabled
			}
		}

		if _, updErr := st.UpdateAccount(ctx, updated); updErr != nil {
			return res, fmt.Errorf("update seed account %s: %w", slug, updErr)
		}
		res.Updated++
	}

	return res, nil
}
