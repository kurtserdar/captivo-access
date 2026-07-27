// Command connector is the captivo-access connector agent: it runs inside
// the customer's data center, enrolls with the Manager using a pairing code,
// dials out to the data-plane over WSS, and proxies allowlisted internal
// HTTP requests to local upstreams. The connector never accepts inbound
// connections and never dials a host it wasn't explicitly configured with.
package main

import (
	"log"
	"os"
)

func main() {
	managerURL := os.Getenv("MANAGER_URL")
	dataplaneURL := os.Getenv("DATAPLANE_URL")
	tokenFile := envOr("TOKEN_FILE", "/data/token")

	upstreams, err := ParseUpstreams(os.Getenv("UPSTREAMS"))
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

	log.Printf("connector starting, %d upstream(s) allowlisted", len(upstreams))
	runClient(dataplaneURL, token, upstreams)
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
	return string(b)
}
