package tunnel

// ProbeRequest is the first control frame on a probe stream. The connector
// TCP-connects to the host:port of UpstreamUrl and replies with a
// ProbeResponse — it never makes an HTTP request. Kind is "probe".
type ProbeRequest struct {
	Kind        string `json:"kind"` // "probe"
	UpstreamUrl string `json:"upstreamUrl"`
}

// ProbeResponse reports the outcome of a ProbeRequest.
type ProbeResponse struct {
	Ok        bool   `json:"ok"`
	LatencyMs int    `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
}
