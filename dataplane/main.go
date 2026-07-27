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

	"github.com/kurtserdar/captivo-access/tunnel"
)

func main() {
	secret := os.Getenv("DATAPLANE_SECRET")
	ctrl := NewControlClient(env("CONTROL_PLANE_URL", "http://access-manager:3100"), secret)
	reg := NewRegistry()
	srv := &Server{reg: reg, ctrl: ctrl}

	// WSS listener (exposed to connectors).
	wss := http.NewServeMux()
	wss.HandleFunc("/tunnel", srv.HandleTunnel)
	wss.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	go func() { log.Fatal(http.ListenAndServe(env("WSS_ADDR", ":3101"), wss)) }()

	// Internal API (compose-internal only; guarded by x-dataplane-secret).
	in := http.NewServeMux()
	in.HandleFunc("/proxy", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-dataplane-secret") != secret {
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
	in.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	log.Fatal(http.ListenAndServe(env("INTERNAL_ADDR", ":3102"), in))
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
