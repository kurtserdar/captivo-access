package main

import (
	"testing"
	"time"
)

func TestWebActivityTouchAndList(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "app.internal")
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
	tr.Touch("u1", "s1", "h")
	// 121s later, the entry is beyond a 120s idle window.
	tr.now = func() time.Time { return base.Add(121 * time.Second) }
	if got := tr.List(120 * time.Second); len(got) != 0 {
		t.Fatalf("expected pruned, got %+v", got)
	}
}

func TestWebActivityKeepsStartedAtAcrossTouches(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "h")
	tr.now = func() time.Time { return base.Add(30 * time.Second) }
	tr.Touch("u1", "s1", "h2") // within window → same span, host updates, StartedAt kept
	got := tr.List(120 * time.Second)
	if len(got) != 1 || !got[0].StartedAt.Equal(base) || !got[0].LastSeen.Equal(base.Add(30*time.Second)) || got[0].Host != "h2" {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestWebActivityGapStartsNewSpan(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "h")
	// A gap longer than the window prunes, then a later Touch is a fresh span.
	tr.now = func() time.Time { return base.Add(200 * time.Second) }
	tr.List(120 * time.Second) // prunes the stale entry
	tr.Touch("u1", "s1", "h")
	got := tr.List(120 * time.Second)
	if len(got) != 1 || !got[0].StartedAt.Equal(base.Add(200*time.Second)) {
		t.Fatalf("expected new span, got %+v", got)
	}
}

func TestWebActivityDistinctPairs(t *testing.T) {
	tr := NewWebActivityTracker()
	tr.now = func() time.Time { return time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC) }
	tr.Touch("u1", "s1", "h")
	tr.Touch("u1", "s2", "h")
	tr.Touch("u2", "s1", "h")
	if got := tr.List(120 * time.Second); len(got) != 3 {
		t.Fatalf("expected 3 distinct, got %d", len(got))
	}
}
