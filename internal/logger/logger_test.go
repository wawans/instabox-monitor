package logger

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoggerProductionDoesNotCreateLogFiles(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "logs")
	var stdout bytes.Buffer

	log, closer, err := newWithNow(false, dir, &stdout, time.Now)
	if err != nil {
		t.Fatalf("newWithNow(false) error: %v", err)
	}
	defer closer.Close()

	log.Debug("hidden debug message")
	log.Info("visible info message")

	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("expected log directory %s NOT to be created in production mode", dir)
	}
	out := stdout.String()
	if strings.Contains(out, "hidden debug message") {
		t.Errorf("debug message should not appear in production mode")
	}
	if !strings.Contains(out, "visible info message") {
		t.Errorf("info message missing from stdout")
	}
}

func TestLoggerDebugWritesDailyFileRotatesAndPrunes(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "logs")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	baseTime := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	// Seed an old file (10 days old -> must be pruned) and a recent file (3 days old -> must stay)
	oldFile := filepath.Join(dir, "log-2026-11-14.log")
	recentFile := filepath.Join(dir, "log-2026-11-21.log")
	otherFile := filepath.Join(dir, "notes.txt")
	for _, p := range []string{oldFile, recentFile, otherFile} {
		if err := os.WriteFile(p, []byte("seed\n"), 0o640); err != nil {
			t.Fatalf("write seed %s: %v", p, err)
		}
	}

	curTime := baseTime
	var stdout bytes.Buffer
	log, closer, err := newWithNow(true, dir, &stdout, func() time.Time { return curTime })
	if err != nil {
		t.Fatalf("newWithNow(true) error: %v", err)
	}
	defer closer.Close()

	log.Debug("day one debug line")

	day1Path := filepath.Join(dir, "log-2026-11-24.log")
	content1, err := os.ReadFile(day1Path)
	if err != nil {
		t.Fatalf("expected %s to exist: %v", day1Path, err)
	}
	if !strings.Contains(string(content1), "day one debug line") {
		t.Errorf("day1 file missing expected log line: %s", string(content1))
	}
	if !strings.Contains(stdout.String(), "day one debug line") {
		t.Errorf("stdout missing debug log line")
	}

	// Verify 7-day pruning
	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Errorf("expected old log file %s (>7d) to be pruned", oldFile)
	}
	if _, err := os.Stat(recentFile); err != nil {
		t.Errorf("expected recent log file %s (<=7d) to be kept: %v", recentFile, err)
	}
	if _, err := os.Stat(otherFile); err != nil {
		t.Errorf("expected non-log file %s to remain untouched: %v", otherFile, err)
	}

	// Advance date by 1 day and verify rotation
	curTime = baseTime.Add(24 * time.Hour)
	log.Info("day two rotated line")

	day2Path := filepath.Join(dir, "log-2026-11-25.log")
	content2, err := os.ReadFile(day2Path)
	if err != nil {
		t.Fatalf("expected rotated file %s to exist: %v", day2Path, err)
	}
	if !strings.Contains(string(content2), "day two rotated line") {
		t.Errorf("day2 file missing rotated log line: %s", string(content2))
	}
}
