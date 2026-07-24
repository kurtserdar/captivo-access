export function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID?.trim() || "localhost";
}

/** Origin'in host'u RP-ID ile aynı mı (WebAuthn origin doğrulaması). */
export function originMatchesRp(origin: string, rpId: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === rpId;
  } catch {
    return false;
  }
}

export function getExpectedOrigin(reqOrigin: string): string {
  return reqOrigin;
}
