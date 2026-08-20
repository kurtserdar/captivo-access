package main

import (
	"testing"
	"time"
)

const win = 120 * time.Second

func TestWebActivityTouchAndList(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	if !tr.Touch("u1", "s1", "app.internal", win) {
		t.Fatal("first touch should start a new span (return true)")
	}
	got := tr.List(120 * time.Second)
	if len(got) != 1 || got[0].UserID != "u1" || got[0].SiteID != "s1" || got[0].Host != "app.internal" {
		t.Fatalf("unexpected list: %+v", got)
	}
	if !got[0].StartedAt.Equal(base) || !got[0].LastSeen.Equal(base) {
		t.Fatalf("timestamps wrong: %+v", got[0])
	}
}

func TestWebActivityPrunesIdle(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "h", win)
	tr.now = func() time.Time { return base.Add(121 * time.Second) }
	if got := tr.List(120 * time.Second); len(got) != 0 {
		t.Fatalf("expected pruned, got %+v", got)
	}
}

func TestWebActivityKeepsStartedAtAcrossTouches(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "h", win)
	tr.now = func() time.Time { return base.Add(30 * time.Second) }
	if tr.Touch("u1", "s1", "h2", win) { // within window → same span, not new
		t.Fatal("touch within window should NOT be a new span (return false)")
	}
	got := tr.List(120 * time.Second)
	if len(got) != 1 || !got[0].StartedAt.Equal(base) || !got[0].LastSeen.Equal(base.Add(30*time.Second)) || got[0].Host != "h2" {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestWebActivityGapStartsNewSpan(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "h", win)
	// A gap longer than the window: Touch itself detects it (idle-aware) as a fresh span.
	tr.now = func() time.Time { return base.Add(200 * time.Second) }
	if !tr.Touch("u1", "s1", "h", win) {
		t.Fatal("touch after an idle gap should start a new span (return true)")
	}
	got := tr.List(120 * time.Second)
	if len(got) != 1 || !got[0].StartedAt.Equal(base.Add(200*time.Second)) {
		t.Fatalf("expected new span, got %+v", got)
	}
}

func TestWebActivityDistinctPairs(t *testing.T) {
	tr := NewWebActivityTracker()
	tr.now = func() time.Time { return time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC) }
	tr.Touch("u1", "s1", "h", win)
	tr.Touch("u1", "s2", "h", win)
	tr.Touch("u2", "s1", "h", win)
	if got := tr.List(120 * time.Second); len(got) != 3 {
		t.Fatalf("expected 3 distinct, got %d", len(got))
	}
}
