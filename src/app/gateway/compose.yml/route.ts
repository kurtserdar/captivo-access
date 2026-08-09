import { GATEWAY_COMPOSE } from "@/lib/gateway/assets";

export const dynamic = "force-static";

// The gateway docker-compose the installer fetches. Served from the manager so
// the install works without cloning the repo (and without GitHub reachability).
export async function GET() {
  return new Response(GATEWAY_COMPOSE, {
    headers: { "content-type": "text/yaml; charset=utf-8" },
  });
}
