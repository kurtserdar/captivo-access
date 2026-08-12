export type RequestState = "pending" | "approved" | "denied" | "withdrawn" | "expired";

// Classifies a self-service access request from its grant fields.
export function requestStatus(
  g: { status: string; approvedAt: string | null; endsAt: string | null },
  now: Date,
): RequestState {
  if (g.status === "DENIED") return "denied";
  if (g.status === "REVOKED") return "withdrawn";
  if (!g.approvedAt) return "pending";
  if (g.endsAt && new Date(g.endsAt).getTime() < now.getTime()) return "expired";
  return "approved";
}
