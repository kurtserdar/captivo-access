package main

import (
	"sync"
	"sync/atomic"
	"time"
)

// AuditEvent is one browser-proxy access decision (allow or authenticated
// deny), shipped to the control plane's /api/internal/audit/log for
// durable storage. See BrowserProxy.ServeHTTP for the emit points.
type AuditEvent struct {
	Timestamp time.Time `json:"timestamp"`
	UserID    string    `json:"userId,omitempty"`
	SiteID    string    `json:"siteId,omitempty"`
	Host      string    `json:"host"`
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	Status    int       `json:"status"`
	BytesOut  int64     `json:"bytesOut"`
	Decision  string    `json:"decision"` // "ALLOW" | "DENY"
	Reason    string    `json:"reason,omitempty"`
	ClientIP  string    `json:"clientIp,omitempty"`
	UserAgent string    `json:"userAgent,omitempty"`
}

// AuditQueue is a bounded, in-memory, mutex-protected buffer of AuditEvents
// awaiting flush to the control plane. Enqueue never blocks: once the queue
// is at capacity, the oldest event is dropped to make room for the new one,
// and the drop is counted (Dropped) rather than silently lost. This trades
// audit completeness under sustained overload for a guarantee that the
// browser proxy's hot path never blocks or backpressures on audit I/O.
type AuditQueue struct {
	mu      sync.Mutex
	buf     []AuditEvent
	cap     int
	dropped int64
}

// NewAuditQueue creates a queue holding at most capacity events (minimum 1).
func NewAuditQueue(capacity int) *AuditQueue {
	if capacity < 1 {
		capacity = 1
	}
	return &AuditQueue{cap: capacity}
}

// Enqueue appends ev, dropping the oldest queued event first if the queue
// is already at capacity.
func (q *AuditQueue) Enqueue(ev AuditEvent) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.buf) >= q.cap {
		q.buf = q.buf[1:] // drop oldest
		atomic.AddInt64(&q.dropped, 1)
	}
	q.buf = append(q.buf, ev)
}

// drain removes and returns up to max queued events, oldest first.
func (q *AuditQueue) drain(max int) []AuditEvent {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.buf) == 0 {
		return nil
	}
	if max > len(q.buf) {
		max = len(q.buf)
	}
	out := make([]AuditEvent, max)
	copy(out, q.buf[:max])
	q.buf = q.buf[max:]
	return out
}

// Dropped returns the total number of events dropped so far because the
// queue was full when Enqueue was called.
func (q *AuditQueue) Dropped() int64 { return atomic.LoadInt64(&q.dropped) }

// RunAuditFlush periodically drains up to batch events from q and hands
// them to send. It runs until the process exits (the ticker is never
// stopped in normal operation); a failed send is best-effort — the drained
// events are not re-enqueued, and it's send's/the caller's responsibility
// to log the failure.
func RunAuditFlush(q *AuditQueue, send func([]AuditEvent) error, interval time.Duration, batch int) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for range t.C {
		evs := q.drain(batch)
		if len(evs) == 0 {
			continue
		}
		_ = send(evs) // best-effort; errors are logged by the caller's send wrapper
	}
}
