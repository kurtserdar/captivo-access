package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
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

	recorderOnce sync.Once
	recorderJS   []byte
	recorderErr  error
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
// ErrNoSite. recordSessions reports whether session recording is enabled for
// this site (see Site.recordSessions).
func (c *ControlClient) SiteByHost(host string) (siteID, connectorID, upstreamUrl string, insecureSkipVerify bool, recordSessions bool, err error) {
	var out struct {
		SiteID             string `json:"siteId"`
		ConnectorID        string `json:"connectorId"`
		UpstreamUrl        string `json:"upstreamUrl"`
		InsecureSkipVerify bool   `json:"insecureSkipVerify"`
		RecordSessions     bool   `json:"recordSessions"`
	}
	if err := c.post("/api/internal/site/by-host", map[string]string{"host": host}, &out); err != nil {
		if he, ok := err.(*httpError); ok && he.code == http.StatusNotFound {
			return "", "", "", false, false, ErrNoSite
		}
		return "", "", "", false, false, err
	}
	return out.SiteID, out.ConnectorID, out.UpstreamUrl, out.InsecureSkipVerify, out.RecordSessions, nil
}

// RecorderJS returns the rrweb recorder bundle served by the control plane
// at GET /api/internal/recorder. The response is fetched once per process
// and cached in memory (via sync.Once) — including a fetch error, so a
// failed first attempt keeps failing until the process restarts. That's an
// acceptable trade-off here: recording is fail-silent (browserproxy replies
// 404 on error, which simply disables recording for that page load) and the
// bundle never changes at runtime.
func (c *ControlClient) RecorderJS() ([]byte, error) {
	c.recorderOnce.Do(func() {
		req, err := http.NewRequest(http.MethodGet, c.BaseURL+"/api/internal/recorder", nil)
		if err != nil {
			c.recorderErr = err
			return
		}
		req.Header.Set("x-dataplane-secret", c.Secret)
		resp, err := c.HTTP.Do(req)
		if err != nil {
			c.recorderErr = err
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			c.recorderErr = &httpError{resp.StatusCode}
			return
		}
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			c.recorderErr = err
			return
		}
		c.recorderJS = b
	})
	return c.recorderJS, c.recorderErr
}

// SendRecording ships one rrweb batch to the control plane's ingest
// endpoint. body is the raw JSON the browser posted to /__captivo/rec —
// {recordingKey, seq, events} — which is merged with the userId/siteId/host
// the proxy resolved for this request into the shape
// src/app/api/internal/recording/ingest/route.ts expects. Best-effort: the
// caller (browserproxy) ignores the error, since recording must never affect
// the proxied response.
func (c *ControlClient) SendRecording(userID, siteID, host string, body []byte) error {
	var batch map[string]any
	if err := json.Unmarshal(body, &batch); err != nil {
		return err
	}
	if batch == nil {
		batch = map[string]any{}
	}
	batch["userId"] = userID
	batch["siteId"] = siteID
	batch["host"] = host
	return c.post("/api/internal/recording/ingest", batch, nil)
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
	// Accept any 2xx as success: most internal routes reply 200, but
	// /api/internal/recording/ingest replies 204 (no body) on success.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &httpError{resp.StatusCode}
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

type httpError struct{ code int }

func (e *httpError) Error() string { return "control-plane returned non-200" }
