// De-risk spike helper for the credential vault (Task 1 Step 6).
// Builds a guacamole-auth-json `data` blob and prints a curl to prove the format,
// plus the two browser-handoff URLs to try. Run:
//   JSON_SECRET_KEY=<32 hex> GUAC_PORT=8080 PROTO=ssh HOST=10.0.0.5 PORT=22 \
//   USER=root PASS=secret pnpm dlx tsx scripts/vault-spike.mts
import { buildAuthData } from "../src/lib/vault/guac-json";

const key = (process.env.JSON_SECRET_KEY ?? "").trim();
if (key.length !== 32) {
  console.error("Set JSON_SECRET_KEY to 32 hex chars (openssl rand -hex 16).");
  process.exit(1);
}
const guacPort = process.env.GUAC_PORT ?? "8080";
const proto = process.env.PROTO ?? "ssh";
const host = process.env.HOST ?? "10.0.0.5";
const port = process.env.PORT ?? "22";
const user = process.env.USER ?? "root";
const pass = process.env.PASS ?? "secret";

const doc = {
  username: "spike@example.com",
  expires: 4102444800000, // year 2100, so it never expires during the test
  connections: {
    "Spike target": {
      protocol: proto,
      parameters: { hostname: host, port, username: user, password: pass },
    },
  },
};
const data = buildAuthData(key, doc);

console.log("\n=== 1) FORMAT CHECK (expect 200 + {\"authToken\":...,\"dataSource\":\"json\"}) ===");
console.log(`curl -i --data-urlencode 'data=${data}' http://localhost:${guacPort}/guacamole/api/tokens\n`);
console.log("=== 2) BROWSER HANDOFF — open each; note which drops you into the session ===");
console.log(`A) http://localhost:${guacPort}/guacamole/#/?data=${encodeURIComponent(data)}`);
console.log(`B) http://localhost:${guacPort}/guacamole/?data=${encodeURIComponent(data)}\n`);
console.log("Report: did (1) return 200? which of A/B (or neither) opened the connection?");
