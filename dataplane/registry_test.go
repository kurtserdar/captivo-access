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
