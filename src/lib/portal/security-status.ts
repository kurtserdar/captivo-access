export interface StatusLine {
  label: string;
  tone: "good" | "info" | "muted";
}

// Derives the vendor's security-status lines from real account state. No fake
// timestamps: passkey reflects enrollment, recording reflects whether any granted
// resource is recorded, VPN-less is a product constant.
export function securityStatus(input: { hasPasskey: boolean; anyRecorded: boolean }): StatusLine[] {
  const lines: StatusLine[] = [];
  lines.push(input.hasPasskey
    ? { label: "Passkey enabled", tone: "good" }
    : { label: "Passkey not set up", tone: "muted" });
  if (input.anyRecorded) lines.push({ label: "Sessions recorded & audited", tone: "info" });
  lines.push({ label: "No VPN required", tone: "muted" });
  return lines;
}
