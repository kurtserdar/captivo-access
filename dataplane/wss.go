package main

import (
	"context"
	"net/http"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
	"github.com/kurtserdar/captivo-access/tunnel"
)

// Server handles connector WSS connections and hosts the connector
// registry shared with the internal /proxy API.
type Server struct {
	reg  *Registry
	ctrl *ControlClient
}

// HandleTunnel upgrades a connector's WSS connection to a yamux server
// session after validating its bearer token against the control plane. It
// blocks for the lifetime of the session and cleans up (deregister +
// report OFFLINE) on exit.
func (s *Server) HandleTunnel(w http.ResponseWriter, r *http.Request) {
	token := bearer(r.Header.Get("Authorization"))
	connectorID, err := s.ctrl.AuthConnector(token)
	if err != nil || connectorID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}

	// NetConn gives us an io.ReadWriteCloser/net.Conn we can hand to yamux.
	netConn := websocket.NetConn(context.Background(), c, websocket.MessageBinary)
	mux, err := yamux.Server(netConn, tunnel.SessionConfig())
	if err != nil {
		c.Close(websocket.StatusInternalError, "yamux setup failed")
		return
	}

	s.reg.Set(connectorID, &Session{mux: mux})
	s.ctrl.ReportStatus(connectorID, "ONLINE", r.RemoteAddr, r.Header.Get("X-Connector-Version"))
	defer func() {
		s.reg.Remove(connectorID)
		s.ctrl.ReportStatus(connectorID, "OFFLINE", r.RemoteAddr, "")
		mux.Close()
	}()

	// Block until the session dies (yamux keepalive detects a dead peer).
	<-mux.CloseChan()
}

func bearer(h string) string {
	const p = "Bearer "
	if len(h) > len(p) && h[:len(p)] == p {
		return h[len(p):]
	}
	return ""
}
