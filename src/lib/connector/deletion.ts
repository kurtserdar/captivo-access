export type ConnectorDeleteCheck = { ok: true } | { ok: false; reason: "not_revoked" | "has_sites" };

// A connector can be hard-deleted only when it's REVOKED and has no sites — the
// Site.connectorId FK is onDelete:Cascade, so deleting a connector with sites
// would silently remove those sites and their access grants.
export function canDeleteConnector(input: { status: string; siteCount: number }): ConnectorDeleteCheck {
  if (input.status !== "REVOKED") return { ok: false, reason: "not_revoked" };
  if (input.siteCount > 0) return { ok: false, reason: "has_sites" };
  return { ok: true };
}
