package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// AccountSnapshot stores the latest polled fleet payload for an account to support
// instant startup loading and startup freshness checks.
type AccountSnapshot struct {
	AccountID        string
	MachinesJSON     string
	PortsJSON        string
	MetricsJSON      string
	FetchedAt        time.Time
	MetricsFetchedAt *time.Time
}

// SaveSnapshot upserts the latest snapshot for an account.
func (s *Store) SaveSnapshot(ctx context.Context, snap AccountSnapshot) error {
	if snap.MachinesJSON == "" {
		snap.MachinesJSON = "[]"
	}
	if snap.PortsJSON == "" {
		snap.PortsJSON = "[]"
	}
	if snap.MetricsJSON == "" {
		snap.MetricsJSON = "{}"
	}
	if snap.FetchedAt.IsZero() {
		snap.FetchedAt = time.Now().UTC()
	}
	var metricsAt sql.NullString
	if snap.MetricsFetchedAt != nil && !snap.MetricsFetchedAt.IsZero() {
		metricsAt = sql.NullString{String: formatTime(*snap.MetricsFetchedAt), Valid: true}
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO account_snapshots (account_id, machines_json, ports_json, metrics_json, fetched_at, metrics_fetched_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(account_id) DO UPDATE SET
			machines_json = excluded.machines_json,
			ports_json = excluded.ports_json,
			metrics_json = excluded.metrics_json,
			fetched_at = excluded.fetched_at,
			metrics_fetched_at = COALESCE(excluded.metrics_fetched_at, account_snapshots.metrics_fetched_at)
	`, snap.AccountID, snap.MachinesJSON, snap.PortsJSON, snap.MetricsJSON, formatTime(snap.FetchedAt), metricsAt)
	if err != nil {
		return fmt.Errorf("save snapshot for %s: %w", snap.AccountID, err)
	}
	return nil
}

// GetSnapshot loads the latest persisted snapshot for a single account.
func (s *Store) GetSnapshot(ctx context.Context, accountID string) (AccountSnapshot, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT account_id, machines_json, ports_json, metrics_json, fetched_at, metrics_fetched_at
		FROM account_snapshots WHERE account_id = ?
	`, accountID)
	snap, err := scanSnapshot(row)
	if errors.Is(err, sql.ErrNoRows) {
		return AccountSnapshot{}, ErrNotFound
	}
	return snap, err
}

// ListSnapshots loads all persisted account snapshots.
func (s *Store) ListSnapshots(ctx context.Context) ([]AccountSnapshot, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT account_id, machines_json, ports_json, metrics_json, fetched_at, metrics_fetched_at
		FROM account_snapshots
	`)
	if err != nil {
		return nil, fmt.Errorf("list snapshots: %w", err)
	}
	defer rows.Close()

	var out []AccountSnapshot
	for rows.Next() {
		snap, err := scanSnapshot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, snap)
	}
	return out, rows.Err()
}

func scanSnapshot(r rowScanner) (AccountSnapshot, error) {
	var (
		snap             AccountSnapshot
		fetchedAt        string
		metricsFetchedAt sql.NullString
	)
	if err := r.Scan(&snap.AccountID, &snap.MachinesJSON, &snap.PortsJSON, &snap.MetricsJSON, &fetchedAt, &metricsFetchedAt); err != nil {
		return AccountSnapshot{}, err
	}
	snap.FetchedAt = parseTime(fetchedAt)
	if metricsFetchedAt.Valid && metricsFetchedAt.String != "" {
		t := parseTime(metricsFetchedAt.String)
		snap.MetricsFetchedAt = &t
	}
	return snap, nil
}
