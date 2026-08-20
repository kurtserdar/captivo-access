// Content-Length guard for the internal ingest endpoints. They are secret-gated,
// but a rogue/compromised data-plane still shouldn't be able to drive an
// unbounded JSON parse + DB write. A missing/invalid Content-Length is treated
// as within-limit (chunked bodies fall back to the caller's own size caps).
export function contentLengthExceeds(req: Request, maxBytes: number): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false;
  const len = Number(raw);
  return Number.isFinite(len) && len > maxBytes;
}
