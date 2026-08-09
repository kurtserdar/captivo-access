import { NextRequest } from "next/server";
import { managerBaseUrl } from "@/lib/url";
import { gatewayInstallScript } from "@/lib/gateway/assets";

export const dynamic = "force-dynamic";

// Served self-contained gateway installer — `curl -fsSL <manager>/gateway/install.sh | sh`.
// No secret: it's a generic Guacamole recipe, safe to fetch and inspect.
export async function GET(req: NextRequest) {
  return new Response(gatewayInstallScript(managerBaseUrl(req)), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
