package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPruneDriveDir(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old")
	fresh := filepath.Join(root, "fresh")
	_ = os.Mkdir(old, 0o755)
	_ = os.Mkdir(fresh, 0o755)
	past := time.Now().Add(-24 * time.Hour)
	_ = os.Chtimes(old, past, past)

	pruneDriveDir(root, 12*time.Hour, time.Now())

	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("old dir was not pruned")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("fresh dir was pruned")
	}
}
