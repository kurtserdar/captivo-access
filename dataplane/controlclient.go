package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

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
