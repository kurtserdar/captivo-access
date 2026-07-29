// Command dataplane is the captivo-access data-plane service: it accepts
// connector WSS tunnels (each backed by a yamux session), and exposes an
// internal /proxy API the control plane uses to round-trip HTTP requests
// through a connector.
package main

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/kurtserdar/captivo-access/tunnel"
)

func main() {
	secret := os.Getenv("DATAPLANE_SECRET")
	ctrl := NewControlClient(env("CONTROL_PLANE_URL", "http://access-manager:3100"), secret)
	reg := NewRegistry()
	srv := &Server{reg: reg, ctrl: ctrl, rl: newRateLimiter()}

	// WSS listener (exposed to connectors).
	wss := http.NewServeMux()
	wss.HandleFunc("/tunnel", srv.HandleTunnel)
	wss.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	go func() { log.Fatal(http.ListenAndServe(env("WSS_ADDR", ":3101"), wss)) }()

	// Internal API (compose-internal only; guarded by x-dataplane-secret).
	in := http.NewServeMux()
	in.HandleFunc("/proxy", func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("x-dataplane-secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var body struct {
			ConnectorID  string              `json:"connectorId"`
			UpstreamName string              `json:"upstreamName"`
			Method       string              `json:"method"`
			Path         string              `json:"path"`
			Header       map[string][]string `json:"header"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_body"})
			return
		}
		res, err := Proxy(reg.Get(body.ConnectorID), tunnel.DialRequest{
			UpstreamName: body.UpstreamName, Method: body.Method, Path: body.Path, Header: body.Header,
		})
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":      res.Status,
			"header":      res.Header,
			"bodyPreview": base64.StdEncoding.EncodeToString(res.Body),
			"truncated":   res.Truncated,
		})
	})
	in.HandleFunc("/kick", func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("x-dataplane-secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var body struct {
			ConnectorID string `json:"connectorId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ConnectorID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_body"})
			return
		}
		if s := reg.Get(body.ConnectorID); s != nil && s.mux != nil {
			s.mux.Close()
		}
		reg.Remove(body.ConnectorID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	in.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	go func() { log.Fatal(http.ListenAndServe(env("INTERNAL_ADDR", ":3102"), in)) }()

	// Browser-facing identity-aware proxy. A front TLS proxy sits in front
	// of this listener in production; it terminates TLS and forwards here.
	managerURL := env("MANAGER_PUBLIC_URL", "")
	if managerURL == "" {
		log.Printf("WARNING: MANAGER_PUBLIC_URL is empty; unauthenticated proxy requests will redirect to a relative /login on the site host and may loop")
	}
	audit := NewAuditQueue(envInt("AUDIT_QUEUE_CAP", 10000))
	go RunAuditFlush(audit, func(evs []AuditEvent) error {
		err := ctrl.SendAudit(evs)
		if err != nil {
			log.Printf("audit flush failed: %v (dropped total=%d)", err, audit.Dropped())
		}
		return err
	}, 5*time.Second, 200)

	proxy := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: managerURL, audit: audit}
	log.Fatal(http.ListenAndServe(env("PROXY_ADDR", ":3103"), proxy))
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return d
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
