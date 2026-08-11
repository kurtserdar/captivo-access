package main

import (
	"context"
	"log"
	"net/http"

	"github.com/coder/websocket"
)

// serveGuacView attaches a read-only viewer to an active gateway session. The
// viewer receives the live guac stream from attach time (no history). A viewer
// that holds control (set via the manager control endpoint) has its input
// injected into the session's guacd conn; otherwise its input is dropped.
func serveGuacView(hub *SessionHub, ctrl *ControlClient, w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session")
	if sessionID == "" {
		http.Error(w, "missing session", http.StatusBadRequest)
		return
	}
	ck, err := r.Cookie("ca_session")
	if err != nil || ck.Value == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	viewerUserID, _, err := ctrl.ResolveSession(ck.Value)
	if err != nil || viewerUserID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	allow, err := ctrl.ViewAuthz(viewerUserID)
	if err != nil || !allow {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	ls := hub.Get(sessionID)
	if ls == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	viewerID, ch := ls.addViewer()
	defer ls.removeViewer(viewerID)

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		Subprotocols:       []string{"guacamole"},
	})
	if err != nil {
		log.Printf("guac-view session=%s: ws accept failed err=%v", sessionID, err)
		return
	}
	c.SetReadLimit(-1)
	defer c.CloseNow()
	ctx := context.Background()
	log.Printf("guac-view session=%s viewer=%s: attached", sessionID, viewerUserID)

	errc := make(chan error, 2)
	// hub -> viewer browser
	go func() {
		for inst := range ch {
			if werr := c.Write(ctx, websocket.MessageText, inst); werr != nil {
				errc <- werr
				return
			}
		}
		errc <- nil // channel closed: session ended or viewer detached
	}()
	// viewer browser -> guacd (only while this viewer holds control)
	go func() {
		for {
			_, data, rerr := c.Read(ctx)
			if rerr != nil {
				errc <- rerr
				return
			}
			if !ls.viewerInputAllowed(viewerUserID) {
				continue
			}
			if werr := ls.writeToGuac(data); werr != nil {
				errc <- werr
				return
			}
		}
	}()
	<-errc
}
