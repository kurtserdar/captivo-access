// Bellek-içi, tek-instance rate-limit. Self-host tek container/replica
// senaryosu için yeterli — çoklu instance/dağıtık deployment için (Redis vb.
// paylaşımlı store) fast-follow gerekir.
const hits = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (e.count >= limit) return false;
  e.count++;
  return true;
}
