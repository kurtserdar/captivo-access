package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync/atomic"
)

// isoGuard is a single-flight lock. buildNavigateRequest/buildResetRequest are the
// minimal HTTP calls to a browser container's control server (:7900). (The A-path
// broker in isolated.go uses a different, per-session request set.)
type isoGuard struct{ busy int32 }

func (g *isoGuard) tryAcquire() bool { return atomic.CompareAndSwapInt32(&g.busy, 0, 1) }
func (g *isoGuard) release()         { atomic.StoreInt32(&g.busy, 0) }

func buildNavigateRequest(host, target string) string {
	return "GET /navigate?url=" + url.QueryEscape(target) + " HTTP/1.0\r\n" +
		"Host: " + host + "\r\nConnection: close\r\n\r\n"
}

func buildResetRequest(host string) string {
	return "POST /reset HTTP/1.0\r\nHost: " + host + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
}

// kasmSession is B1's single-flight lock (one hi-fi session at a time; a broker
// for concurrency is a follow-up, mirroring A1→A2).
var kasmSession isoGuard

// kasmDesc is the ISOLATED-hi-fi connection descriptor from the control plane.
type kasmDesc struct {
	Transport       string `json:"transport"`
	NavigateUrl     string `json:"navigateUrl"`
	KasmAddr        string `json:"kasmAddr"`
	KasmControlAddr string `json:"kasmControlAddr"`
	ConnectorID     string `json:"connectorId"`
	Record          bool   `json:"record"`
}

// serveKasmTunnel reverse-proxies the vendor's HTTP/WebSocket request to a KasmVNC
// backend (web client + RFB-over-WS on one port) THROUGH the connector. The browser
// is navigated to the site URL on the WebSocket-upgrade request (the session
// boundary); HTML/asset requests just serve the client. The credential/target never
// leaves the customer network — the data-plane only relays.
func serveKasmTunnel(ctrl *ControlClient, reg *Registry, w http.ResponseWriter, r *http.Request) {
	ck, err := r.Cookie("ca_session")
	if err != nil || ck.Value == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, _, err := ctrl.ResolveSession(ck.Value)
	if err != nil || userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	siteID := r.URL.Query().Get("site")
	if siteID == "" {
		if c, e := r.Cookie("ca_kasm_site"); e == nil {
			siteID = c.Value
		}
	}
	var d kasmDesc
	if err := ctrl.post("/api/internal/gateway/descriptor", map[string]string{"userId": userID, "siteId": siteID}, &d); err != nil || d.Transport != "kasm" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	// Pin the site for the follow-up asset/WS requests (the iframe loads /kasm-tunnel/
	// without ?site on its sub-requests).
	if r.URL.Query().Get("site") != "" {
		http.SetCookie(w, &http.Cookie{Name: "ca_kasm_site", Value: siteID, Path: "/kasm-tunnel", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	}
	sess := reg.Get(d.ConnectorID)
	if sess == nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}

	// The guard + navigate live on the WebSocket-upgrade request — the real session
	// boundary (one long-lived RFB WS). A 2nd concurrent WS is rejected (would share
	// the same KasmVNC display = data leak); concurrency is a later slice.
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		if !kasmSession.tryAcquire() {
			http.Error(w, "isolated browser at capacity", http.StatusServiceUnavailable)
			return
		}
		defer kasmSession.release()
		if st, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
			_, _ = st.Write([]byte(buildResetRequest(d.KasmControlAddr)))
			_ = st.Close()
		}
		if st, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
			_, _ = st.Write([]byte(buildNavigateRequest(d.KasmControlAddr, d.NavigateUrl)))
			_ = st.Close()
		}
		log.Printf("kasm-tunnel site=%s: hi-fi session started", siteID)
	}

	target, _ := url.Parse("http://" + d.KasmAddr)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return dialGuacd(sess, d.KasmAddr) // relay to KasmVNC through the connector
		},
	}
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/kasm-tunnel")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}
	proxy.ServeHTTP(w, r)
}
