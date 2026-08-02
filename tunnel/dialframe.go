package tunnel

// DialRequest is the first control frame sent on a proxied stream. It
// describes which upstream URL to reach and the HTTP request line/headers to
// replay against it; the raw HTTP body follows as subsequent stream bytes.
type DialRequest struct {
	UpstreamUrl string              `json:"upstreamUrl"`
	Method      string              `json:"method"`
	Path        string              `json:"path"`
	Header      map[string][]string `json:"header,omitempty"`
}

// DialResponse is the control frame returned in reply to a DialRequest,
// carrying the upstream's response status/headers before the response body
// follows as stream bytes.
type DialResponse struct {
	Status int                 `json:"status"`
	Header map[string][]string `json:"header,omitempty"`
	Error  string              `json:"error,omitempty"`
}
