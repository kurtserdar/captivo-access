package main

import "testing"

func TestLogRingCapAndTail(t *testing.T) {
	r := newLogRing(3)
	for _, s := range []string{"one\n", "two\n", "three\n", "four\n"} {
		_, _ = r.Write([]byte(s))
	}
	got := r.tail(10)
	if len(got) != 3 || got[0] != "two" || got[2] != "four" {
		t.Fatalf("bad tail after cap: %v", got)
	}
	if last := r.tail(1); len(last) != 1 || last[0] != "four" {
		t.Fatalf("bad tail(1): %v", last)
	}
	// Blank lines are skipped.
	_, _ = r.Write([]byte("\n"))
	if len(r.tail(10)) != 3 {
		t.Fatalf("blank line should not be stored")
	}
}
