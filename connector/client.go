package main

import (
	"context"
	"log"
	"math"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
	"github.com/kurtserdar/captivo-access/tunnel"
)

// maxBackoff caps the reconnect delay after repeated dial failures.
const maxBackoff = 30 * time.Second

// runClient keeps a tunnel session to the data-plane alive for the life of
// the process, reconnecting with exponential backoff (capped at
// maxBackoff) whenever the session drops or fails to establish.
func runClient(dataplaneURL, token string, upstreams map[string]string) {
	attempt := 0
	for {
		if err := connectOnce(dataplaneURL, token, upstreams); err != nil {
			backoff := time.Duration(math.Min(float64(maxBackoff), math.Pow(2, float64(attempt))*float64(time.Second)))
			log.Printf("connector: tunnel error: %v (retrying in %s)", err, backoff)
			attempt++
			time.Sleep(backoff)
			continue
		}
		attempt = 0
	}
}

// connectOnce dials the data-plane's /tunnel WSS endpoint, establishes a
// yamux client session over it, and serves incoming streams until the
// session dies. It returns once the session ends (error or clean close).
func connectOnce(dataplaneURL, token string, upstreams map[string]string) error {
	ctx := context.Background()
	c, _, err := websocket.Dial(ctx, dataplaneURL+"/tunnel", &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Authorization":       {"Bearer " + token},
			"X-Connector-Version": {Version},
		},
	})
	if err != nil {
		return err
	}

	netConn := websocket.NetConn(ctx, c, websocket.MessageBinary)
	mux, err := yamux.Client(netConn, tunnel.SessionConfig())
	if err != nil {
		c.Close(websocket.StatusInternalError, "yamux setup failed")
		return err
	}

	log.Printf("connector: tunnel established to %s", dataplaneURL)
	serveStreams(mux, upstreams) // blocks until the session dies
	return mux.Close()
}
