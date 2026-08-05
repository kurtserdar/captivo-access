package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

// ErrNoSite is returned by SiteByHost when the control plane has no site
// registered for the given host (404).
var ErrNoSite = errors.New("no site for host")

// ControlClient talks to the control-plane's internal connector APIs
// (Task 4: POST /api/internal/connector/auth and /status), authenticated
// via the shared x-dataplane-secret header.
type ControlClient struct {
	BaseURL, Secret string
	HTTP            *http.Client
}

func NewControlClient(base, secret string) *ControlClient {
	return &ControlClient{BaseURL: base, Secret: secret, HTTP: &http.Client{Timeout: 10 * time.Second}}
}

// AuthConnector validates a connector's bearer token against the control
// plane and returns the resolved connectorId, or an error if invalid.
func (c *ControlClient) AuthConnector(token string) (string, error) {
	var out struct {
		ConnectorID string `json:"connectorId"`
	}
	if err := c.post("/api/internal/connector/auth", map[string]string{"token": token}, &out); err != nil {
		return "", err
	}
	return out.ConnectorID, nil
}

// ReportStatus tells the control plane a connector went ONLINE/OFFLINE.
// Best-effort: errors are swallowed since this must never block tunnel
// teardown/setup.
func (c *ControlClient) ReportStatus(connectorID, status, remoteAddr, version string) {
	_ = c.post("/api/internal/connector/status",
		map[string]string{"connectorId": connectorID, "status": status, "remoteAddr": remoteAddr, "version": version}, nil)
}

// ResolveSession exchanges a browser session token for the userId it
// belongs to. A non-200 response (no such session, or an expired/invalid
// token) is not treated as an error: it simply means "no session", and the
// caller should treat the request as unauthenticated.
func (c *ControlClient) ResolveSession(token string) (string, error) {
	var out struct {
		UserID string `json:"userId"`
	}
	if err := c.post("/api/internal/session/resolve", map[string]string{"token": token}, &out); err != nil {
		if isHTTPStatus(err) {
			return "", nil
		}
		return "", err
	}
	return out.UserID, nil
}

// SiteByHost resolves a browser-facing hostname to the site/connector it's
// routed to. If the control plane has no site for host, it returns
// ErrNoSite.
func (c *ControlClient) SiteByHost(host string) (siteID, connectorID, upstreamUrl string, insecureSkipVerify bool, err error) {
	var out struct {
		SiteID             string `json:"siteId"`
		ConnectorID        string `json:"connectorId"`
		UpstreamUrl        string `json:"upstreamUrl"`
		InsecureSkipVerify bool   `json:"insecureSkipVerify"`
	}
	if err := c.post("/api/internal/site/by-host", map[string]string{"host": host}, &out); err != nil {
		if he, ok := err.(*httpError); ok && he.code == http.StatusNotFound {
			return "", "", "", false, ErrNoSite
		}
		return "", "", "", false, err
	}
	return out.SiteID, out.ConnectorID, out.UpstreamUrl, out.InsecureSkipVerify, nil
}

// CheckAccess evaluates whether userId is allowed to reach siteId right
// now, returning a human-mappable deny reason when allow is false.
func (c *ControlClient) CheckAccess(userID, siteID string) (allow bool, reason string, err error) {
	var out struct {
		Allow  bool   `json:"allow"`
		Reason string `json:"reason"`
	}
	if err := c.post("/api/internal/access/check", map[string]string{"userId": userID, "siteId": siteID}, &out); err != nil {
		return false, "", err
	}
	return out.Allow, out.Reason, nil
}

// SendAudit ships a batch of audit events to the control plane for durable
// storage. Called by RunAuditFlush; best-effort (see AuditQueue).
func (c *ControlClient) SendAudit(events []AuditEvent) error {
	return c.post("/api/internal/audit/log", map[string]any{"events": events}, nil)
}

func isHTTPStatus(err error) bool {
	_, ok := err.(*httpError)
	return ok
}

func (c *ControlClient) post(path string, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-dataplane-secret", c.Secret)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &httpError{resp.StatusCode}
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

type httpError struct{ code int }

func (e *httpError) Error() string { return "control-plane returned non-200" }
