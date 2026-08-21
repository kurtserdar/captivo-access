package main

import (
	"os"
	"path/filepath"
	"time"
)

// pruneDriveDir removes top-level dirs under root whose mtime is older than maxAge.
// Per-session RDP drive dirs (/drive/<sessionID>) accumulate; this bounds them.
func pruneDriveDir(root string, maxAge time.Duration, now time.Time) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) > maxAge {
			_ = os.RemoveAll(filepath.Join(root, e.Name()))
		}
	}
}

// startDriveCleanup prunes old drive session dirs hourly. No-op when root is
// absent (i.e. the guacd drive volume isn't mounted).
func startDriveCleanup(root string) {
	if _, err := os.Stat(root); err != nil {
		return
	}
	go func() {
		for {
			pruneDriveDir(root, 12*time.Hour, time.Now())
			time.Sleep(time.Hour)
		}
	}()
}
