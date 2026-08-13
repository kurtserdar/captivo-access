// Pure, db-free helpers for connector install / re-pair / in-place update. A
// revoked connector can't be re-paired (its token never validates anyway — use
// delete/re-add instead).
export function canRepairConnector(status: string): boolean {
  return status !== "REVOKED";
}

// Shared docker network the connector + guacd join so the connector can reach
// guacd (`captivo-guacd`) by name.
export const GATEWAY_NETWORK = "captivo-gateway";

// The `docker run` invocation for the connector container. Pass `code` to enroll
// a connector (install / re-pair); omit it to update an already-paired connector
// in place (the token already in /data re-authenticates). Every connector bundles
// guacd (the RDP/SSH/VNC engine for native remote desktops) on the shared
// GATEWAY_NETWORK, idempotently — baked in so it survives every recreate/update
// and every connector can serve remote-desktop resources. Pure + db-free.
function runCommand(managerUrl: string, tunnelUrl: string, code?: string, pull = true): string {
  const guacd =
    `docker network inspect ${GATEWAY_NETWORK} >/dev/null 2>&1 || docker network create ${GATEWAY_NETWORK} && ` +
    `docker run --rm -v captivo_guacd_recordings:/rec -v captivo_guacd_logs:/log -v captivo_guacd_drive:/drive2 busybox chown -R 1000:1000 /rec /log /drive2 && ` +
    `docker rm -f captivo-guacd >/dev/null 2>&1; ` +
    `docker run -d --name captivo-guacd --restart unless-stopped --network ${GATEWAY_NETWORK} ` +
    `-v captivo_guacd_recordings:/recordings -v captivo_guacd_logs:/guaclog -v captivo_guacd_drive:/drive ` +
    // guacd 1.6.0's entrypoint execs guacd directly and appends "$@" as guacd args,
    // so a `/bin/sh -c '…|tee…'` CMD would be swallowed. Bypass the entrypoint to run
    // our own shell wrapper that tees guacd's output into the shared log volume.
    `--entrypoint /bin/sh guacamole/guacd:1.6.0 -c '/opt/guacamole/sbin/guacd -b 0.0.0.0 -L info -f 2>&1 | tee /guaclog/guacd.log' && `;
  // Pull the connector image right before running it. `docker run <img>:latest`
  // reuses a locally-cached `latest` and will NOT fetch a newer build — a fresh
  // install on a host that ran an older connector would silently start the stale
  // image. Gated by `&&` after the (self-contained) guacd block, so the shell
  // precedence of the guacd block's `||` is unaffected. The update command sets
  // pull=false because it already pulls first (to minimise connector downtime).
  const pullCmd = pull ? "docker pull ghcr.io/kurtserdar/captivo-access-connector:latest && " : "";
  return (
    guacd +
    pullCmd +
    "docker run -d --name access-connector --restart unless-stopped " +
    `--network ${GATEWAY_NETWORK} ` +
    `-e MANAGER_URL=${managerUrl} ` +
    `-e DATAPLANE_URL=${tunnelUrl} ` +
    (code ? `-e PAIR_CODE=${code} ` : "") +
    "-v access_connector_data:/data " +
    "-v captivo_guacd_logs:/guaclog:ro -v captivo_guacd_drive:/drive:rw " +
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
  return (
    "docker rm -f access-connector && docker volume rm access_connector_data && " +
    buildConnectorRunCommand(code, managerUrl, tunnelUrl)
  );
}

// Update an already-paired connector in place: pull the new image and recreate
// the container, KEEPING the token volume (so no re-pairing). No PAIR_CODE — the
// existing /data/token re-authenticates against the same manager-side connector.
export function buildConnectorUpdateCommand(managerUrl: string, tunnelUrl: string): string {
  return (
    "docker pull ghcr.io/kurtserdar/captivo-access-connector:latest && " +
    "docker rm -f access-connector && " +
    runCommand(managerUrl, tunnelUrl, undefined, false)
  );
}
