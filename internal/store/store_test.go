package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestStoreAccountsSnapshotsSessionsAndEvents(t *testing.T) {
	ctx := context.Background()
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer st.Close()

	// 1. Account CRUD & duplicate detection
	acc, err := st.CreateAccount(ctx, Account{
		ID:         "acc-1",
		Slug:       "prod",
		Name:       "Prod Account",
		APIKeyEnc:  []byte("encrypted-bytes"),
		APIKeyHash: "hash-abc",
		KeyHint:    "ibk_••••1234",
		Enabled:    true,
		Source:     SourceUI,
	})
	if err != nil {
		t.Fatalf("CreateAccount error: %v", err)
	}
	if !acc.CanWrite() {
		t.Errorf("expected CanWrite() = true")
	}

	// Duplicate slug fails with ErrDuplicate
	if _, err := st.CreateAccount(ctx, Account{
		ID:         "acc-2",
		Slug:       "prod",
		Name:       "Dup",
		APIKeyEnc:  []byte("x"),
		APIKeyHash: "hash-xyz",
		KeyHint:    "ibk_••••9999",
		Enabled:    true,
	}); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("expected ErrDuplicate on duplicate slug, got %v", err)
	}

	found, err := st.FindAccountByAPIKeyHash(ctx, "hash-abc")
	if err != nil || found.ID != "acc-1" {
		t.Fatalf("FindAccountByAPIKeyHash = (%+v, %v), want acc-1", found, err)
	}

	// 2. Snapshots save/load & cascade delete
	now := time.Now().UTC().Truncate(time.Millisecond)
	if err := st.SaveSnapshot(ctx, AccountSnapshot{
		AccountID:        "acc-1",
		MachinesJSON:     `[{"id":"m_1","name":"vm-1"}]`,
		PortsJSON:        `[]`,
		MetricsJSON:      `{"m_1":{"cpuUsedPct":42}}`,
		FetchedAt:        now,
		MetricsFetchedAt: &now,
	}); err != nil {
		t.Fatalf("SaveSnapshot error: %v", err)
	}
	snap, err := st.GetSnapshot(ctx, "acc-1")
	if err != nil {
		t.Fatalf("GetSnapshot error: %v", err)
	}
	if snap.MachinesJSON != `[{"id":"m_1","name":"vm-1"}]` || !snap.FetchedAt.Equal(now) {
		t.Errorf("snapshot mismatch: %+v", snap)
	}

	// 3. Sessions
	if err := st.CreateSession(ctx, Session{
		TokenHash: "tok-valid",
		Username:  "admin",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}); err != nil {
		t.Fatalf("CreateSession error: %v", err)
	}
	if err := st.CreateSession(ctx, Session{
		TokenHash: "tok-expired",
		Username:  "admin",
		ExpiresAt: time.Now().UTC().Add(-time.Minute),
	}); err != nil {
		t.Fatalf("CreateSession expired error: %v", err)
	}
	sess, err := st.GetSession(ctx, "tok-valid")
	if err != nil || sess.Username != "admin" {
		t.Fatalf("GetSession(valid) = (%+v, %v)", sess, err)
	}
	if _, err := st.GetSession(ctx, "tok-expired"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for expired session, got %v", err)
	}

	// 4. Activity events
	if err := st.AddActivityEvent(ctx, ActivityEvent{
		AccountID:   "acc-1",
		MachineID:   "m_1",
		MachineName: "vm-1",
		EventType:   "lifecycle",
		Detail:      "Started vm-1",
	}); err != nil {
		t.Fatalf("AddActivityEvent error: %v", err)
	}
	events, err := st.ListActivityEvents(ctx, 10)
	if err != nil || len(events) != 1 || events[0].Detail != "Started vm-1" {
		t.Fatalf("ListActivityEvents = (%+v, %v)", events, err)
	}

	// 5. Deleting account cascades to snapshots
	if err := st.DeleteAccount(ctx, "acc-1"); err != nil {
		t.Fatalf("DeleteAccount error: %v", err)
	}
	if _, err := st.GetSnapshot(ctx, "acc-1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected snapshot cascade delete, got %v", err)
	}
}
