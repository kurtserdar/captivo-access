package tunnel

// WsDialRequest is the first control frame on a WebSocket-passthrough stream
// (Kind "ws"). It names the upstream to reach and carries the browser's
// upgrade request headers to replay verbatim against it. After the handshake
// the stream carries raw, bidirectional WebSocket bytes (no body framing).
type WsDialRequest struct {
	Kind               string              `json:"kind"` // "ws"
	UpstreamUrl        string              `json:"upstreamUrl"`
	Path               string              `json:"path"`
	Header             map[string][]string `json:"header,omitempty"`
	InsecureSkipVerify bool                `json:"insecureSkipVerify,omitempty"`
}

// WsDialResponse is the control frame the connector returns after attempting
// the upstream handshake: Status is the upstream's response code (101 on a
// successful upgrade), Header the upstream's response headers to replay to the
// browser, or Error a dial/handshake failure. On a non-101 status the stream
// carries no further bytes.
type WsDialResponse struct {
	Status int                 `json:"status"`
	Header map[string][]string `json:"header,omitempty"`
	Error  string              `json:"error,omitempty"`
}
