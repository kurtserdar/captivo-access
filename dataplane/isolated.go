package main

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
)

// openBrowserSession asks the in-container broker to start an isolated browser at
// url and returns the assigned VNC port. It writes an HTTP/1.0 POST /session and
// reads the response over the same relay stream. status is the HTTP status (so the
// caller can surface 503 capacity); err is set only on transport/parse failure.
func openBrowserSession(rw io.ReadWriter, host, url string) (id string, vncPort, status int, err error) {
	body := `{"url":` + jsonQuote(url) + `}`
	req := "POST /session HTTP/1.0\r\n" +
		"Host: " + host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Content-Length: " + strconv.Itoa(len(body)) + "\r\n" +
		"Connection: close\r\n\r\n" + body
	if _, err = io.WriteString(rw, req); err != nil {
		return "", 0, 0, err
	}
	resp, rerr := http.ReadResponse(bufio.NewReader(rw), nil)
	if rerr != nil {
		return "", 0, 0, rerr
	}
	defer resp.Body.Close()
	status = resp.StatusCode
	if status/100 != 2 {
		return "", 0, status, nil
	}
	var out struct {
		ID      string `json:"id"`
		VncPort int    `json:"vncPort"`
	}
	if derr := json.NewDecoder(resp.Body).Decode(&out); derr != nil {
		return "", 0, status, derr
	}
	return out.ID, out.VncPort, status, nil
}

// buildCloseRequest formats the broker POST /session/<id>/close call.
func buildCloseRequest(host, id string) string {
	return "POST /session/" + id + "/close HTTP/1.0\r\nHost: " + host +
		"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
}

// jsonQuote JSON-quotes a string (safe against embedded quotes/backslashes).
func jsonQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
