// Command connector is the captivo-access connector agent: it runs inside
// the customer's data center, enrolls with the Manager using a pairing code,
// dials out to the data-plane over WSS, and proxies HTTP requests to
// internal targets the Manager routes to it, optionally constrained by
// ALLOWED_TARGETS. The connector never accepts inbound connections.
package main

import (
	"io"
	"log"
	"os"
	"strings"
)

func main() {
	// Keep stderr (docker logs) and also capture recent lines for the console tail.
	log.SetOutput(io.MultiWriter(os.Stderr, logRingBuf))

	managerURL := os.Getenv("MANAGER_URL")
	dataplaneURL := os.Getenv("DATAPLANE_URL")
	tokenFile := envOr("TOKEN_FILE", "/data/token")

	allow, err := ParseAllowedTargets(os.Getenv("ALLOWED_TARGETS"))
	if err != nil {
		log.Fatal(err)
	}

	token := readToken(tokenFile)
	if token == "" {
		pairCode := os.Getenv("PAIR_CODE")
		if pairCode == "" {
			log.Fatal("no stored token and no PAIR_CODE set")
		}
		token, err = enroll(managerURL, pairCode, tokenFile)
		if err != nil {
			log.Fatal("enroll: ", err)
		}
		log.Print("connector: enrolled and stored token")
	}

	log.Print("connector starting")
	runClient(dataplaneURL, token, allow)
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func readToken(f string) string {
	b, err := os.ReadFile(f)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}
