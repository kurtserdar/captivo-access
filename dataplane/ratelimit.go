package main

import (
	"sync"
	"time"
)

// rlEntry tracks a single key's request count within the current window.
type rlEntry struct {
	count int
	reset time.Time
}

// rateLimiter is a mutex-guarded in-memory fixed-window rate limiter keyed
// by an arbitrary string (e.g. client IP). It is intentionally simple: no
// background eviction, entries are overwritten in place once their window
// expires. Fine for the /tunnel auth path, which has a small, bounded key
// space (distinct source IPs hitting one dataplane instance).
type rateLimiter struct {
	mu sync.Mutex
	m  map[string]*rlEntry
}

func newRateLimiter() *rateLimiter { return &rateLimiter{m: map[string]*rlEntry{}} }

// allow reports whether key is under limit within window, and records the
// attempt. The first call for a key (or the first after its window has
// elapsed) starts a fresh window.
func (r *rateLimiter) allow(key string, limit int, window time.Duration) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	e := r.m[key]
	if e == nil || now.After(e.reset) {
		r.m[key] = &rlEntry{count: 1, reset: now.Add(window)}
		return true
	}
	if e.count >= limit {
		return false
	}
	e.count++
	return true
}
