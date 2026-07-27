package main

import (
	"testing"
	"time"
)

func TestRateLimiterAllowsUpToLimitThenDenies(t *testing.T) {
	rl := newRateLimiter()
	for i := 0; i < 3; i++ {
		if !rl.allow("1.2.3.4", 3, time.Minute) {
			t.Fatalf("expected request %d to be allowed", i+1)
		}
	}
	if rl.allow("1.2.3.4", 3, time.Minute) {
		t.Fatal("expected 4th request within window to be denied")
	}
	// A different key must have its own independent budget.
	if !rl.allow("5.6.7.8", 3, time.Minute) {
		t.Fatal("expected a different key to be unaffected by another key's limit")
	}
}

func TestRateLimiterResetsAfterWindow(t *testing.T) {
	rl := newRateLimiter()
	window := 20 * time.Millisecond
	if !rl.allow("1.2.3.4", 1, window) {
		t.Fatal("expected first request to be allowed")
	}
	if rl.allow("1.2.3.4", 1, window) {
		t.Fatal("expected second request within window to be denied")
	}
	time.Sleep(window + 15*time.Millisecond)
	if !rl.allow("1.2.3.4", 1, window) {
		t.Fatal("expected request after window reset to be allowed")
	}
}
