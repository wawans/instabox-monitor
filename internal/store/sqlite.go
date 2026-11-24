package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a requested record does not exist.
var ErrNotFound = errors.New("not found")

// ErrDuplicate is returned when a unique constraint (slug or api_key_hash) is violated.
var ErrDuplicate = errors.New("duplicate record")

// Store wraps SQLite persistence for accounts, snapshots, sessions, and activity events.
type Store struct {
	db *sql.DB
}

// Open initializes the SQLite database at <dataDir>/monitor.db (or direct file path if ending in .db)
// and runs idempotent schema migrations.
func Open(dataDir string) (*Store, error) {
	if strings.TrimSpace(dataDir) == "" {
		dataDir = "./data"
	}
	var dbPath string
	if strings.HasSuffix(dataDir, ".db") || dataDir == ":memory:" {
		dbPath = dataDir
		if dbPath != ":memory:" {
			if err := os.MkdirAll(filepath.Dir(dbPath), 0o750); err != nil {
				return nil, fmt.Errorf("create db parent dir: %w", err)
			}
		}
	} else {
		if err := os.MkdirAll(dataDir, 0o750); err != nil {
			return nil, fmt.Errorf("create data dir %s: %w", dataDir, err)
		}
		dbPath = filepath.Join(dataDir, "monitor.db")
	}

	dsn := dbPath
	if dbPath != ":memory:" {
		dsn = fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=synchronous(NORMAL)", dbPath)
	} else {
		dsn = "file::memory:?cache=shared&_pragma=foreign_keys(ON)"
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %s: %w", dbPath, err)
	}
	// Single connection eliminates SQLITE_BUSY write contention in embedded single-binary deployments.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate sqlite: %w", err)
	}
	return s, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// Ping verifies database connectivity.
func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *Store) migrate(ctx context.Context) error {
	const schema = `
CREATE TABLE IF NOT EXISTS accounts (
	id TEXT PRIMARY KEY,
	slug TEXT UNIQUE,
	name TEXT NOT NULL,
	base_url TEXT NOT NULL DEFAULT 'https://api.instabox.sh',
	api_key_enc BLOB NOT NULL,
	api_key_hash TEXT NOT NULL DEFAULT '',
	key_hint TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	read_only INTEGER NOT NULL DEFAULT 0,
	write_capable INTEGER,
	source TEXT NOT NULL DEFAULT 'ui',
	user_login TEXT NOT NULL DEFAULT '',
	user_email TEXT NOT NULL DEFAULT '',
	orgs_json TEXT NOT NULL DEFAULT '[]',
	last_sync_at TEXT,
	last_sync_status TEXT NOT NULL DEFAULT 'pending',
	last_error TEXT NOT NULL DEFAULT '',
	consecutive_auth_failures INTEGER NOT NULL DEFAULT 0,
	disabled_reason TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_api_key_hash ON accounts(api_key_hash);

CREATE TABLE IF NOT EXISTS account_snapshots (
	account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
	machines_json TEXT NOT NULL DEFAULT '[]',
	ports_json TEXT NOT NULL DEFAULT '[]',
	metrics_json TEXT NOT NULL DEFAULT '{}',
	fetched_at TEXT NOT NULL,
	metrics_fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS activity_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	account_id TEXT NOT NULL,
	machine_id TEXT NOT NULL DEFAULT '',
	machine_name TEXT NOT NULL DEFAULT '',
	event_type TEXT NOT NULL,
	detail TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_events_created ON activity_events(id DESC);
`
	_, err := s.db.ExecContext(ctx, schema)
	return err
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func parseTime(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t.UTC()
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC()
	}
	return time.Time{}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
