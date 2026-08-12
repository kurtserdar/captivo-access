// Where the "Open" button on an access card points. GATEWAY resources open the
// in-Captivo native session page; web (TRANSPARENT) resources open directly.
// Extracted verbatim from the retired access-view.tsx.
export function launchHref(accessMode: string, siteId: string, hostname: string): string {
  return accessMode === "GATEWAY" ? `/gateway/${siteId}/session` : `https://${hostname}`;
}
