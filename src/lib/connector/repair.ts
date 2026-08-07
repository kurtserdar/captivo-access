// Pure, db-free helpers for connector install / re-pair / in-place update. A
// revoked connector can't be re-paired (its token never validates anyway — use
// delete/re-add instead).
export function canRepairConnector(status: string): boolean {
  return status !== "REVOKED";
}

// The `docker run` invocation for the connector container. Pass `code` to enroll
// a connector (install / re-pair); omit it to update an already-paired connector
// in place (the token already in /data re-authenticates). Pure + db-free.
function runCommand(managerUrl: string, tunnelUrl: string, code?: string): string {
  return (
    "docker run -d --name access-connector --restart unless-stopped " +
    `-e MANAGER_URL=${managerUrl} ` +
    `-e DATAPLANE_URL=${tunnelUrl} ` +
    (code ? `-e PAIR_CODE=${code} ` : "") +
    "-v access_connector_data:/data " +
    "ghcr.io/kurtserdar/captivo-access-connector:latest"
  );
}

export function buildConnectorRunCommand(code: string, managerUrl: string, tunnelUrl: string): string {
  return runCommand(managerUrl, tunnelUrl, code);
}

export function buildInstallCommand(code: string, managerUrl: string, tunnelUrl: string): string {
  return buildConnectorRunCommand(code, managerUrl, tunnelUrl);
}

// Re-pair clears the connector's token volume first, so the Go agent (which
// ignores PAIR_CODE when /data/token is present) re-enrolls with the new code
// and rebinds to the SAME manager-side connector.
export function buildReconfigureCommand(code: string, managerUrl: string, tunnelUrl: string): string {
  return "docker rm -f access-connector && docker volume rm access_connector_data && " + buildConnectorRunCommand(code, managerUrl, tunnelUrl);
}

// Update an already-paired connector in place: pull the new image and recreate
// the container, KEEPING the token volume (so no re-pairing). No PAIR_CODE — the
// existing /data/token re-authenticates against the same manager-side connector.
export function buildConnectorUpdateCommand(managerUrl: string, tunnelUrl: string): string {
  return (
    "docker pull ghcr.io/kurtserdar/captivo-access-connector:latest && " +
    "docker rm -f access-connector && " +
    runCommand(managerUrl, tunnelUrl)
  );
}
