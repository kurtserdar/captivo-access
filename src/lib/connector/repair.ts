// Pure, db-free helpers for connector re-pair. A revoked connector can't be
// re-paired (its token never validates anyway — use delete/re-add instead).
export function canRepairConnector(status: string): boolean {
  return status !== "REVOKED";
}

// The `docker run` invocation shared by the initial install and the re-pair
// reconfigure commands. Pure + db-free.
export function buildConnectorRunCommand(code: string, managerUrl: string, tunnelUrl: string): string {
  return (
    "docker run -d --name access-connector --restart unless-stopped " +
    `-e MANAGER_URL=${managerUrl} ` +
    `-e DATAPLANE_URL=${tunnelUrl} ` +
    `-e PAIR_CODE=${code} ` +
    "-v access_connector_data:/data " +
    "ghcr.io/kurtserdar/captivo-access-connector:latest"
  );
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
