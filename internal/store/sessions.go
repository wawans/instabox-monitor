package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Session represents an authenticated dashboard login session.
type Session struct {
	TokenHash string
	Username  string
	ExpiresAt time.Time
	CreatedAt time.Time
}

// CreateSession stores a hashed session token.
func (s *Store) CreateSession(ctx context.Context, sess Session) error {
	if sess.CreatedAt.IsZero() {
		sess.CreatedAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (token_hash, username, expires_at, created_at)
		VALUES (?, ?, ?, ?)
	`, sess.TokenHash, sess.Username, formatTime(sess.ExpiresAt), formatTime(sess.CreatedAt))
	if err != nil {
		return fmt.Errorf("insert session: %w", err)
	}
	return nil
}

// GetSession retrieves a non-expired session by token hash.
func (s *Store) GetSession(ctx context.Context, tokenHash string) (Session, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT token_hash, username, expires_at, created_at
		FROM sessions WHERE token_hash = ?
	`, tokenHash)
	var (
		sess      Session
		expiresAt string
		createdAt string
	)
	if err := row.Scan(&sess.TokenHash, &sess.Username, &expiresAt, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Session{}, ErrNotFound
		}
		return Session{}, err
	}
	sess.ExpiresAt = parseTime(expiresAt)
	sess.CreatedAt = parseTime(createdAt)
	if time.Now().UTC().After(sess.ExpiresAt) {
		_ = s.DeleteSession(ctx, tokenHash)
		return Session{}, ErrNotFound
	}
	return sess, nil
}

// DeleteSession revokes a single session.
func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

// PurgeExpiredSessions cleans up expired login sessions.
func (s *Store) PurgeExpiredSessions(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, formatTime(time.Now().UTC()))
	return err
}
