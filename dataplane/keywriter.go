package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// keyWriter posts reconstructed keystroke events to the manager, which encrypts +
// stores them as SessionKeyEvent rows keyed by the recording key. Best-effort — a
// failed POST never blocks the session.
type keyWriter struct {
	managerURL, secret, key string
	client                  *http.Client
}

func newKeyWriter(managerURL, secret, key string) *keyWriter {
	return &keyWriter{managerURL: managerURL, secret: secret, key: key, client: &http.Client{Timeout: 10 * time.Second}}
}

func (w *keyWriter) post(events []keyEvent) {
	if len(events) == 0 {
		return
	}
	body, _ := json.Marshal(map[string]any{"recordingKey": w.key, "events": events})
	req, err := http.NewRequest(http.MethodPost, w.managerURL+"/api/internal/recording/keyevents", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-dataplane-secret", w.secret)
	resp, err := w.client.Do(req)
	if err != nil {
		log.Printf("keyevents key=%s: post failed err=%v", w.key, err)
		return
	}
	resp.Body.Close()
}
