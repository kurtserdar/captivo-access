package main

import (
	"reflect"
	"testing"
)

func TestSplitLinesCompleteAndPartial(t *testing.T) {
	lines, rem := splitLines([]byte("alpha\nbeta\ngam"))
	if !reflect.DeepEqual(lines, []string{"alpha", "beta"}) {
		t.Fatalf("lines = %v", lines)
	}
	if string(rem) != "gam" {
		t.Fatalf("remainder = %q", rem)
	}
}

func TestSplitLinesTrailingNewlineNoRemainder(t *testing.T) {
	lines, rem := splitLines([]byte("one\ntwo\n"))
	if !reflect.DeepEqual(lines, []string{"one", "two"}) || len(rem) != 0 {
		t.Fatalf("lines=%v rem=%q", lines, rem)
	}
}

func TestSplitLinesDropsEmptyAndTrimsCR(t *testing.T) {
	lines, _ := splitLines([]byte("a\r\n\nb\n"))
	if !reflect.DeepEqual(lines, []string{"a", "b"}) {
		t.Fatalf("lines = %v", lines)
	}
}

func TestSplitLinesRemainderCarriesForward(t *testing.T) {
	_, rem := splitLines([]byte("par"))
	lines, rem2 := splitLines(append(rem, []byte("tial\ndone\n")...))
	if !reflect.DeepEqual(lines, []string{"partial", "done"}) || len(rem2) != 0 {
		t.Fatalf("lines=%v rem=%q", lines, rem2)
	}
}
