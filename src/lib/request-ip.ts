// The original client IP of a console request, read from the front proxy's
// headers. nginx sets X-Real-IP to the connecting address; Caddy (shipped) sets
// X-Forwarded-For. Prefer X-Real-IP (exactly the proxy's peer, unspoofable),
// else the rightmost X-Forwarded-For hop (the one our own proxy appended).
export function clientIp(headers: Headers): string | undefined {
  const real = headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return undefined;
}
