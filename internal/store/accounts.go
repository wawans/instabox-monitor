package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	SourceUI   = "ui"
	SourceSeed = "seed"

	StatusPending         = "pending"
	StatusOK              = "ok"
	StatusAuthError       = "auth_error"
	StatusAutoDisabled    = "auto_disabled"
	StatusKeyError        = "key_error"
	StatusPermissionError = "permission_error"
	StatusRateLimited     = "rate_limited"
	StatusError           = "error"
)

// Account represents a persisted InstaBox account configuration and health state.
// Plaintext API keys are never stored or returned.
type Account struct {
	ID                      string     `json:"id"`
	Slug                    string     `json:"slug,omitempty"`
	Name                    string     `json:"name"`
	BaseURL                 string     `json:"baseUrl"`
	APIKeyEnc               []byte     `json:"-"`
	APIKeyHash              string     `json:"-"`
	KeyHint                 string     `json:"keyHint"`
	Enabled                 bool       `json:"enabled"`
	ReadOnly                bool       `json:"readOnly"`
	WriteCapable            *bool      `json:"writeCapable"`
	Source                  string     `json:"source"`
	UserLogin               string     `json:"userLogin"`
	UserEmail               string     `json:"userEmail"`
	OrgsJSON                string     `json:"-"`
	LastSyncAt              *time.Time `json:"lastSyncAt"`
	LastSyncStatus          string     `json:"lastSyncStatus"`
	LastError               string     `json:"lastError"`
	ConsecutiveAuthFailures int        `json:"consecutiveAuthFailures"`
	DisabledReason          string     `json:"disabledReason"`
	CreatedAt               time.Time  `json:"createdAt"`
	UpdatedAt               time.Time  `json:"updatedAt"`
}

// CanWrite reports whether lifecycle write actions are permitted for this account.
func (a Account) CanWrite() bool {
	if !a.Enabled || a.ReadOnly {
		return false
	}
	if a.LastSyncStatus == StatusKeyError || a.LastSyncStatus == StatusAutoDisabled {
		return false
	}
	if a.WriteCapable != nil && !*a.WriteCapable {
		return false
	}
	return true
}

// CreateAccount inserts a new account row.
func (s *Store) CreateAccount(ctx context.Context, a Account) (Account, error) {
	now := time.Now().UTC()
	if a.BaseURL == "" {
		a.BaseURL = "https://api.instabox.sh"
	}
	if a.Source == "" {
		a.Source = SourceUI
	}
	if a.LastSyncStatus == "" {
		a.LastSyncStatus = StatusPending
	}
	if a.OrgsJSON == "" {
		a.OrgsJSON = "[]"
	}
	a.CreatedAt = now
	a.UpdatedAt = now

	var slug sql.NullString
	if strings.TrimSpace(a.Slug) != "" {
		slug = sql.NullString{String: strings.TrimSpace(a.Slug), Valid: true}
	}
	var writeCap sql.NullInt64
	if a.WriteCapable != nil {
		writeCap = sql.NullInt64{Int64: int64(boolToInt(*a.WriteCapable)), Valid: true}
	}
	var lastSync sql.NullString
	if a.LastSyncAt != nil {
		lastSync = sql.NullString{String: formatTime(*a.LastSyncAt), Valid: true}
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO accounts (
			id, slug, name, base_url, api_key_enc, api_key_hash, key_hint,
			enabled, read_only, write_capable, source, user_login, user_email, orgs_json,
			last_sync_at, last_sync_status, last_error, consecutive_auth_failures, disabled_reason,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		a.ID, slug, a.Name, a.BaseURL, a.APIKeyEnc, a.APIKeyHash, a.KeyHint,
		boolToInt(a.Enabled), boolToInt(a.ReadOnly), writeCap, a.Source, a.UserLogin, a.UserEmail, a.OrgsJSON,
		lastSync, a.LastSyncStatus, a.LastError, a.ConsecutiveAuthFailures, a.DisabledReason,
		formatTime(a.CreatedAt), formatTime(a.UpdatedAt),
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return Account{}, ErrDuplicate
		}
		return Account{}, fmt.Errorf("insert account: %w", err)
	}
	return a, nil
}

// ListAccounts returns all configured accounts ordered by creation time.
func (s *Store) ListAccounts(ctx context.Context) ([]Account, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, slug, name, base_url, api_key_enc, api_key_hash, key_hint,
		       enabled, read_only, write_capable, source, user_login, user_email, orgs_json,
		       last_sync_at, last_sync_status, last_error, consecutive_auth_failures, disabled_reason,
		       created_at, updated_at
		FROM accounts
		ORDER BY created_at ASC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	defer rows.Close()

	var out []Account
	for rows.Next() {
		a, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetAccount fetches a single account by ID.
func (s *Store) GetAccount(ctx context.Context, id string) (Account, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, slug, name, base_url, api_key_enc, api_key_hash, key_hint,
		       enabled, read_only, write_capable, source, user_login, user_email, orgs_json,
		       last_sync_at, last_sync_status, last_error, consecutive_auth_failures, disabled_reason,
		       created_at, updated_at
		FROM accounts WHERE id = ?
	`, id)
	a, err := scanAccount(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	return a, err
}

// GetAccountBySlug fetches a single account by slug.
func (s *Store) GetAccountBySlug(ctx context.Context, slug string) (Account, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, slug, name, base_url, api_key_enc, api_key_hash, key_hint,
		       enabled, read_only, write_capable, source, user_login, user_email, orgs_json,
		       last_sync_at, last_sync_status, last_error, consecutive_auth_failures, disabled_reason,
		       created_at, updated_at
		FROM accounts WHERE slug = ?
	`, slug)
	a, err := scanAccount(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	return a, err
}

// FindAccountByAPIKeyHash finds an existing account matching the HMAC API key hash.
func (s *Store) FindAccountByAPIKeyHash(ctx context.Context, hash string) (Account, error) {
	if hash == "" {
		return Account{}, ErrNotFound
	}
	row := s.db.QueryRowContext(ctx, `
		SELECT id, slug, name, base_url, api_key_enc, api_key_hash, key_hint,
		       enabled, read_only, write_capable, source, user_login, user_email, orgs_json,
		       last_sync_at, last_sync_status, last_error, consecutive_auth_failures, disabled_reason,
		       created_at, updated_at
		FROM accounts WHERE api_key_hash = ? LIMIT 1
	`, hash)
	a, err := scanAccount(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	return a, err
}

// UpdateAccount updates mutable configuration fields of an account.
func (s *Store) UpdateAccount(ctx context.Context, a Account) (Account, error) {
	a.UpdatedAt = time.Now().UTC()
	var slug sql.NullString
	if strings.TrimSpace(a.Slug) != "" {
		slug = sql.NullString{String: strings.TrimSpace(a.Slug), Valid: true}
	}
	var writeCap sql.NullInt64
	if a.WriteCapable != nil {
		writeCap = sql.NullInt64{Int64: int64(boolToInt(*a.WriteCapable)), Valid: true}
	}
	var lastSync sql.NullString
	if a.LastSyncAt != nil {
		lastSync = sql.NullString{String: formatTime(*a.LastSyncAt), Valid: true}
	}

	res, err := s.db.ExecContext(ctx, `
		UPDATE accounts SET
			slug = ?, name = ?, base_url = ?, api_key_enc = ?, api_key_hash = ?, key_hint = ?,
			enabled = ?, read_only = ?, write_capable = ?, source = ?,
			user_login = ?, user_email = ?, orgs_json = ?,
			last_sync_at = ?, last_sync_status = ?, last_error = ?,
			consecutive_auth_failures = ?, disabled_reason = ?, updated_at = ?
		WHERE id = ?
	`,
		slug, a.Name, a.BaseURL, a.APIKeyEnc, a.APIKeyHash, a.KeyHint,
		boolToInt(a.Enabled), boolToInt(a.ReadOnly), writeCap, a.Source,
		a.UserLogin, a.UserEmail, a.OrgsJSON,
		lastSync, a.LastSyncStatus, a.LastError,
		a.ConsecutiveAuthFailures, a.DisabledReason, formatTime(a.UpdatedAt),
		a.ID,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return Account{}, ErrDuplicate
		}
		return Account{}, fmt.Errorf("update account: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return Account{}, ErrNotFound
	}
	return a, nil
}

// UpdateAccountSyncState updates sync metadata, identity, and health status fields.
func (s *Store) UpdateAccountSyncState(ctx context.Context, id string, status, lastErr string, syncAt *time.Time, authFailures int, enabled bool, disabledReason string, userLogin, userEmail, orgsJSON string) error {
	now := formatTime(time.Now().UTC())
	var syncAtVal any
	if syncAt != nil {
		syncAtVal = formatTime(*syncAt)
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE accounts SET
			last_sync_status = ?,
			last_error = ?,
			last_sync_at = COALESCE(?, last_sync_at),
			consecutive_auth_failures = ?,
			enabled = ?,
			disabled_reason = ?,
			user_login = CASE WHEN ? != '' THEN ? ELSE user_login END,
			user_email = CASE WHEN ? != '' THEN ? ELSE user_email END,
			orgs_json = CASE WHEN ? != '' THEN ? ELSE orgs_json END,
			updated_at = ?
		WHERE id = ?
	`,
		status, lastErr, syncAtVal, authFailures, boolToInt(enabled), disabledReason,
		userLogin, userLogin, userEmail, userEmail, orgsJSON, orgsJSON,
		now, id,
	)
	return err
}

// SetAccountWriteCapable persists whether the API key supports machines:write.
func (s *Store) SetAccountWriteCapable(ctx context.Context, id string, capable bool) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE accounts SET write_capable = ?, updated_at = ? WHERE id = ?
	`, boolToInt(capable), formatTime(time.Now().UTC()), id)
	return err
}

// DeleteAccount removes an account (and cascades to account_snapshots).
func (s *Store) DeleteAccount(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM accounts WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete account: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanAccount(r rowScanner) (Account, error) {
	var (
		a          Account
		slug       sql.NullString
		enabled    int
		readOnly   int
		writeCap   sql.NullInt64
		lastSyncAt sql.NullString
		createdAt  string
		updatedAt  string
	)
	err := r.Scan(
		&a.ID, &slug, &a.Name, &a.BaseURL, &a.APIKeyEnc, &a.APIKeyHash, &a.KeyHint,
		&enabled, &readOnly, &writeCap, &a.Source, &a.UserLogin, &a.UserEmail, &a.OrgsJSON,
		&lastSyncAt, &a.LastSyncStatus, &a.LastError, &a.ConsecutiveAuthFailures, &a.DisabledReason,
		&createdAt, &updatedAt,
	)
	if err != nil {
		return Account{}, err
	}
	if slug.Valid {
		a.Slug = slug.String
	}
	a.Enabled = enabled != 0
	a.ReadOnly = readOnly != 0
	if writeCap.Valid {
		v := writeCap.Int64 != 0
		a.WriteCapable = &v
	}
	if lastSyncAt.Valid && lastSyncAt.String != "" {
		t := parseTime(lastSyncAt.String)
		a.LastSyncAt = &t
	}
	a.CreatedAt = parseTime(createdAt)
	a.UpdatedAt = parseTime(updatedAt)
	return a, nil
}
