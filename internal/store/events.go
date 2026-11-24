package store

import (
	"context"
	"fmt"
	"time"
)

// ActivityEvent records audit/operational milestones (lifecycle actions, bulk wake, auto-disable, state transitions).
type ActivityEvent struct {
	ID          int64     `json:"id"`
	AccountID   string    `json:"accountId"`
	MachineID   string    `json:"machineId,omitempty"`
	MachineName string    `json:"machineName,omitempty"`
	EventType   string    `json:"eventType"`
	Detail      string    `json:"detail"`
	CreatedAt   time.Time `json:"createdAt"`
}

// AddActivityEvent appends an operational event and caps retention to the newest 1000 rows.
func (s *Store) AddActivityEvent(ctx context.Context, ev ActivityEvent) error {
	if ev.CreatedAt.IsZero() {
		ev.CreatedAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO activity_events (account_id, machine_id, machine_name, event_type, detail, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, ev.AccountID, ev.MachineID, ev.MachineName, ev.EventType, ev.Detail, formatTime(ev.CreatedAt))
	if err != nil {
		return fmt.Errorf("insert activity event: %w", err)
	}
	// Trim oldest events beyond 1000 rows.
	_, _ = s.db.ExecContext(ctx, `
		DELETE FROM activity_events WHERE id NOT IN (
			SELECT id FROM activity_events ORDER BY id DESC LIMIT 1000
		)
	`)
	return nil
}

// ListActivityEvents returns the most recent operational events, newest first.
func (s *Store) ListActivityEvents(ctx context.Context, limit int) ([]ActivityEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, account_id, machine_id, machine_name, event_type, detail, created_at
		FROM activity_events
		ORDER BY id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list activity events: %w", err)
	}
	defer rows.Close()

	var out []ActivityEvent
	for rows.Next() {
		var (
			ev        ActivityEvent
			createdAt string
		)
		if err := rows.Scan(&ev.ID, &ev.AccountID, &ev.MachineID, &ev.MachineName, &ev.EventType, &ev.Detail, &createdAt); err != nil {
			return nil, err
		}
		ev.CreatedAt = parseTime(createdAt)
		out = append(out, ev)
	}
	return out, rows.Err()
}
