package main

import (
	"net/url"
	"sync/atomic"
)

// buildNavigateRequest formats a minimal HTTP/1.0 GET to the browser control
// server's /navigate endpoint. The URL is query-escaped.
func buildNavigateRequest(host, target string) string {
	return "GET /navigate?url=" + url.QueryEscape(target) + " HTTP/1.0\r\n" +
		"Host: " + host + "\r\n" +
		"Connection: close\r\n\r\n"
}

// buildResetRequest formats the POST /reset control call.
func buildResetRequest(host string) string {
	return "POST /reset HTTP/1.0\r\nHost: " + host + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
}

// isoGuard is the A1 single-flight lock: only one ISOLATED session at a time
// (a 2nd concurrent x11vnc viewer would share the same display = data leak).
// Concurrency arrives in Slice A2 (per-session broker).
type isoGuard struct{ busy int32 }

func (g *isoGuard) tryAcquire() bool { return atomic.CompareAndSwapInt32(&g.busy, 0, 1) }
func (g *isoGuard) release()         { atomic.StoreInt32(&g.busy, 0) }
