package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"
)

// Version is the connector build version, sent to the Manager during enroll
// and to the data-plane as X-Connector-Version on every reconnect.
var Version = "dev" // overridden at build via -ldflags -X main.Version=<tag>

// enroll redeems a one-time pairing code with the Manager for a long-lived
// connector token, then persists that token to tokenFile (mode 0600) so
// subsequent restarts skip pairing.
func enroll(managerURL, pairCode, tokenFile string) (string, error) {
	body, err := json.Marshal(map[string]string{"pairCode": pairCode, "version": Version})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, managerURL+"/api/connector/enroll", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/json")

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errors.New("enroll failed")
	}

	var out struct {
		Token string `json:"token"`
	}
	if json.NewDecoder(resp.Body).Decode(&out) != nil || out.Token == "" {
		return "", errors.New("no token")
	}
	if err := os.WriteFile(tokenFile, []byte(out.Token), 0o600); err != nil {
		return "", err
	}
	return out.Token, nil
}
