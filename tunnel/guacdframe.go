package tunnel

// GuacdDialRequest is the first control frame on a guacd stream (Kind "guacd").
// Target is the guacd "host:port" the connector plain-TCP-dials; the Guacamole
// protocol then runs opaquely over the relay.
type GuacdDialRequest struct {
	Kind   string `json:"kind"`   // "guacd"
	Target string `json:"target"` // "host:port"
}

// GuacdDialResponse reports whether the connector reached guacd. Empty Error = ok.
type GuacdDialResponse struct {
	Error string `json:"error,omitempty"`
}
