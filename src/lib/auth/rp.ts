export function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID?.trim() || "localhost";
}

/** Whether the origin's host matches the RP-ID (WebAuthn origin verification). */
export function originMatchesRp(origin: string, rpId: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === rpId;
  } catch {
    return false;
  }
}
