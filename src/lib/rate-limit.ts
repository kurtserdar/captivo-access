// In-memory, single-instance rate limit. Sufficient for the self-hosted
// single container/replica scenario — a multi-instance/distributed deployment
// (shared store such as Redis) will need a fast-follow.
const hits = new Map<string, { count: number; reset: number }>();
let lastSweep = 0;

// Evict expired entries so the map can't grow without bound. Runs at most once
// per second; without it, a flood of distinct keys (e.g. many source IPs) would
// leak memory since entries are otherwise only overwritten on a same-key re-hit.
function sweep(now: number): void {
  if (now - lastSweep < 1_000) return;
  lastSweep = now;
  for (const [k, v] of hits) {
    if (v.reset < now) hits.delete(k);
  }
}

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const e = hits.get(key);
  if (!e || e.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (e.count >= limit) return false;
  e.count++;
  return true;
}
