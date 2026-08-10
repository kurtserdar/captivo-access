package main

import (
	"net/url"
	"sync"
	"time"
)

// Request-level logging. Successful requests are deliberately NOT logged —
// their volume is already captured by the telemetry counters (active/total/
// bytes) — so the recent-log ring stays a signal-dense tail of the things an
// operator actually needs to see: egress denials, upstream failures, and slow
// dials. Repeated events for the same target are throttled so a single broken
// or misconfigured Site can't flood the ring on an asset-heavy page.

// logThrottle rate-limits repeated log keys.
type logThrottle struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func newLogThrottle() *logThrottle { return &logThrottle{last: map[string]time.Time{}} }

// allow reports whether key may log now, recording the time if so. At most one
// true per key per `every` window.
func (t *logThrottle) allow(key string, every time.Duration) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	if last, ok := t.last[key]; ok && now.Sub(last) < every {
		return false
	}
	t.last[key] = now
	if len(t.last) > 512 { // bound the map: drop entries older than 5m
		for k, v := range t.last {
			if now.Sub(v) > 5*time.Minute {
				delete(t.last, k)
			}
		}
	}
	return true
}

var reqThrottle = newLogThrottle()

// hostOf extracts a log-safe host[:port] from an upstream URL. Only the host is
// logged, never the path/query, which can carry tokens or other secrets.
func hostOf(rawURL string) string {
	if u, err := url.Parse(rawURL); err == nil && u.Host != "" {
		return u.Host
	}
	return "?"
}

// logDenied records a fail-closed egress rejection (a target outside
// ALLOWED_TARGETS). Throttled per target so a misconfigured Site doesn't flood.
func logDenied(kind, target string) {
	if reqThrottle.allow("deny:"+kind+":"+target, 30*time.Second) {
		logWarn("egress denied (%s): %s not in ALLOWED_TARGETS", kind, target)
	}
}

// logReject records a malformed/rejected request (bad URL, invalid path).
// Throttled per target.
func logReject(kind, target, reason string) {
	if reqThrottle.allow("rej:"+kind+":"+target+":"+reason, 30*time.Second) {
		logWarn("rejected request (%s) to %s: %s", kind, target, reason)
	}
}

// logUpstreamErr records an upstream dial/response failure. Throttled per
// target (10s) so a broken Site doesn't flood the ring.
func logUpstreamErr(kind, host, reason string) {
	if reqThrottle.allow("err:"+kind+":"+host, 10*time.Second) {
		logWarn("upstream error (%s) %s: %s", kind, host, reason)
	}
}

// logSlowUpstream records a slow but successful dial (time to first response
// header). Throttled per target.
func logSlowUpstream(host string, d time.Duration) {
	if reqThrottle.allow("slow:"+host, 10*time.Second) {
		logWarn("slow upstream %s: %s to first byte", host, d.Round(time.Millisecond))
	}
}

// slowUpstreamThreshold is how long a successful upstream response may take
// before it's logged as slow.
const slowUpstreamThreshold = 5 * time.Second
