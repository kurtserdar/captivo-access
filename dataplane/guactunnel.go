package main

import (
	"bufio"
	"net/http"

	"github.com/coder/websocket"
)

// serveGuacTunnel bridges a browser WebSocket (guacamole-common-js) to guacd
// through the connector. It authenticates the Captivo session, resolves the
// connection descriptor from the manager (grant-checked, credential-decrypted),
// opens guacd, drives the full guacd handshake server-side (guacamole-lite model:
// the server does select/args/connect; the browser only renders + sends input),
// and then relays the Guacamole protocol both ways. The credential appears only
// inside the server-side `connect` instruction and never reaches the browser.
func serveGuacTunnel(ctrl *ControlClient, reg *Registry, w http.ResponseWriter, r *http.Request) {
	siteID := r.URL.Query().Get("site")
	if siteID == "" {
		http.Error(w, "missing site", http.StatusBadRequest)
		return
	}
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

	conn, guacdAddr, connectorID, err := ctrl.GatewayDescriptor(userID, siteID)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	sess := reg.Get(connectorID)
	if sess == nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}
	guac, err := dialGuacd(sess, guacdAddr)
	if err != nil {
		http.Error(w, "guacd unreachable", http.StatusBadGateway)
		return
	}
	defer guac.Close()

	// Server-side handshake (spike-proven sequence).
	br := bufio.NewReader(guac)
	if _, err := guac.Write(encodeInstruction("select", conn.Protocol)); err != nil {
		http.Error(w, "handshake", http.StatusBadGateway)
		return
	}
	op, argNames, err := parseInstruction(br)
	if err != nil || op != "args" {
		http.Error(w, "handshake args", http.StatusBadGateway)
		return
	}
	_, _ = guac.Write(encodeInstruction("size", "1024", "768", "96"))
	_, _ = guac.Write(encodeInstruction("audio"))
	_, _ = guac.Write(encodeInstruction("video"))
	_, _ = guac.Write(encodeInstruction("image"))
	if _, err := guac.Write(buildConnect(argNames, conn)); err != nil {
		http.Error(w, "connect", http.StatusBadGateway)
		return
	}
	op, readyArgs, err := parseInstruction(br)
	if err != nil || op != "ready" {
		http.Error(w, "not ready", http.StatusBadGateway)
		return
	}

	// Upgrade the browser WebSocket and bridge. The browser is same-origin behind
	// the front nginx; skip strict origin checks (the session cookie already
	// authenticated the request).
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	ctx := r.Context()

	// Send `ready` to the browser so guacamole-common-js starts the session.
	if err := c.Write(ctx, websocket.MessageText, encodeInstruction(append([]string{"ready"}, readyArgs...)...)); err != nil {
		return
	}

	errc := make(chan error, 2)
	// guacd -> browser (starting with anything already buffered after `ready`)
	go func() {
		buf := make([]byte, 16384)
		for {
			n, rerr := br.Read(buf)
			if n > 0 {
				if werr := c.Write(ctx, websocket.MessageText, buf[:n]); werr != nil {
					errc <- werr
					return
				}
			}
			if rerr != nil {
				errc <- rerr
				return
			}
		}
	}()
	// browser -> guacd
	go func() {
		for {
			_, data, rerr := c.Read(ctx)
			if rerr != nil {
				errc <- rerr
				return
			}
			if _, werr := guac.Write(data); werr != nil {
				errc <- werr
				return
			}
		}
	}()
	<-errc
}
