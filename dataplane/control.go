package main

import (
	"encoding/json"

	"github.com/kurtserdar/captivo-access/tunnel"
)

// runControl opens the control stream to a freshly-connected connector, sends the
// hello, and stores each telemetry frame the connector reports. Returns when the
// stream (or session) dies. Safe against old connectors: they don't understand the
// control kind, the stream errors out, and telemetry simply stays nil.
func runControl(sess *Session) {
	if sess == nil || sess.mux == nil {
		return
	}
	st, err := sess.mux.Open()
	if err != nil {
		return
	}
	defer st.Close()
	hello, _ := json.Marshal(tunnel.ControlHello{Kind: "control"})
	if tunnel.WriteFrame(st, hello) != nil {
		return
	}
	for {
		b, err := tunnel.ReadFrame(st)
		if err != nil {
			return
		}
		var t tunnel.Telemetry
		if json.Unmarshal(b, &t) == nil {
			sess.SetTelemetry(&t)
		}
	}
}
