// Where the "Open" button on an access card points. GATEWAY and ISOLATED
// resources open the in-Captivo native session page (screen stream); web
// (TRANSPARENT) resources open directly.
export function launchHref(accessMode: string, siteId: string, hostname: string): string {
  return accessMode === "GATEWAY" || accessMode === "ISOLATED" ? `/gateway/${siteId}/session` : `https://${hostname}`;
}
