package main

import "testing"

func TestRegistryAddGetRemove(t *testing.T) {
	r := NewRegistry()
	r.Set("c1", &Session{}) // Session is a thin wrapper; nil-yamux ok for this test
	if r.Get("c1") == nil {
		t.Fatal("expected session")
	}
	r.Remove("c1")
	if r.Get("c1") != nil {
		t.Fatal("expected nil after remove")
	}
}

func TestRegistryRemoveIfSame(t *testing.T) {
	r := NewRegistry()
	sessA := &Session{}
	r.Set("c1", sessA)

	// (a) RemoveIfSame with the same pointer deletes and returns true.
	if !r.RemoveIfSame("c1", sessA) {
		t.Fatal("expected RemoveIfSame to return true for matching session")
	}
	if r.Get("c1") != nil {
		t.Fatal("expected nil after RemoveIfSame")
	}

	// (b) Reconnect race: Set replaces with a new session, then the old
	// session's deferred cleanup calls RemoveIfSame with the stale pointer.
	// It must NOT delete the new live session.
	sessB := &Session{}
	r.Set("c1", sessB)
	sessC := &Session{}
	r.Set("c1", sessC)

	if r.RemoveIfSame("c1", sessB) {
		t.Fatal("expected RemoveIfSame to return false for stale session pointer")
	}
	if r.Get("c1") != sessC {
		t.Fatal("expected live session to remain after stale RemoveIfSame")
	}
}
