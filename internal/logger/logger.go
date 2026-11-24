package logger

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const retentionDays = 7

// Closer wraps logger resources that should be closed on shutdown.
type Closer interface {
	Close() error
}

type nopCloser struct{}

func (nopCloser) Close() error { return nil }

// New creates a structured slog.Logger.
// When debugMode is true (APP_ENV=DEBUG), logs at DEBUG level are written to both
// stdout and <logDir>/log-YYYY-MM-DD.log (using container TZ) with automatic
// daily rotation and 7-day retention pruning.
// When debugMode is false, logs at INFO level go to stdout only and no files or
// directories are created.
func New(debugMode bool, logDir string) (*slog.Logger, Closer, error) {
	return newWithNow(debugMode, logDir, os.Stdout, time.Now)
}

func newWithNow(debugMode bool, logDir string, stdout io.Writer, nowFn func() time.Time) (*slog.Logger, Closer, error) {
	if !debugMode {
		h := slog.NewTextHandler(stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
		return slog.New(h), nopCloser{}, nil
	}

	if strings.TrimSpace(logDir) == "" {
		logDir = "logs"
	}
	dw, err := newDailyFileWriter(logDir, nowFn)
	if err != nil {
		return nil, nil, err
	}
	mw := io.MultiWriter(stdout, dw)
	h := slog.NewTextHandler(mw, &slog.HandlerOptions{Level: slog.LevelDebug})
	return slog.New(h), dw, nil
}

type dailyFileWriter struct {
	mu          sync.Mutex
	dir         string
	nowFn       func() time.Time
	currentDate string
	file        *os.File
}

func newDailyFileWriter(dir string, nowFn func() time.Time) (*dailyFileWriter, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("create log dir %s: %w", dir, err)
	}
	w := &dailyFileWriter{
		dir:   dir,
		nowFn: nowFn,
	}
	if err := w.rotateLocked(nowFn()); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *dailyFileWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	now := w.nowFn()
	dateStr := now.Format("2006-01-02")
	if dateStr != w.currentDate || w.file == nil {
		if err := w.rotateLocked(now); err != nil {
			return 0, err
		}
	}
	return w.file.Write(p)
}

func (w *dailyFileWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}

func (w *dailyFileWriter) rotateLocked(now time.Time) error {
	if w.file != nil {
		_ = w.file.Close()
		w.file = nil
	}
	dateStr := now.Format("2006-01-02")
	path := filepath.Join(w.dir, fmt.Sprintf("log-%s.log", dateStr))
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		return fmt.Errorf("open daily log file %s: %w", path, err)
	}
	w.file = f
	w.currentDate = dateStr
	pruneOldLogs(w.dir, now, retentionDays)
	return nil
}

// pruneOldLogs removes log-YYYY-MM-DD.log files strictly older than keepDays.
func pruneOldLogs(dir string, now time.Time, keepDays int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	// Compare calendar date in the same timezone as now.
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	cutoff := today.AddDate(0, 0, -keepDays)

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, "log-") || !strings.HasSuffix(name, ".log") {
			continue
		}
		datePart := strings.TrimSuffix(strings.TrimPrefix(name, "log-"), ".log")
		parsed, err := time.ParseInLocation("2006-01-02", datePart, now.Location())
		if err != nil {
			continue
		}
		if parsed.Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
}
