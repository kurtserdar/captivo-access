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
// by an arbitrary string (e.g. client IP). Expired entries are swept (at most
// once per second) so the map can't grow without bound — the key space is only
// "small" as long as the key is the un-spoofable client IP; a swept map is
// robust even if that assumption slips.
type rateLimiter struct {
	mu      sync.Mutex
	m       map[string]*rlEntry
	lastSwp time.Time
}

func newRateLimiter() *rateLimiter { return &rateLimiter{m: map[string]*rlEntry{}} }

// sweep drops expired entries. Caller must hold r.mu. Throttled to once/second.
func (r *rateLimiter) sweep(now time.Time) {
	if now.Sub(r.lastSwp) < time.Second {
		return
	}
	r.lastSwp = now
	for k, e := range r.m {
		if now.After(e.reset) {
			delete(r.m, k)
		}
	}
}

// allow reports whether key is under limit within window, and records the
// attempt. The first call for a key (or the first after its window has
// elapsed) starts a fresh window.
func (r *rateLimiter) allow(key string, limit int, window time.Duration) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	r.sweep(now)
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
