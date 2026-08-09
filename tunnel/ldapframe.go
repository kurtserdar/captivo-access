package tunnel

// LdapDialRequest is the first control frame on an LDAP stream (Kind "ldap").
// The connector raw-TCP-dials Target (a "host:port") and, on success, relays
// bytes bidirectionally. The connector does NO TLS or LDAP parsing — any TLS
// (LDAPS / StartTLS) is negotiated end-to-end between the data-plane's LDAP
// client and the directory server, tunnelled through the relay as opaque bytes.
type LdapDialRequest struct {
	Kind   string `json:"kind"`   // "ldap"
	Target string `json:"target"` // host:port
}

// LdapDialResponse reports whether the connector reached Target. An empty Error
// means the connection succeeded and the raw byte relay has begun.
type LdapDialResponse struct {
	Error string `json:"error,omitempty"`
}
