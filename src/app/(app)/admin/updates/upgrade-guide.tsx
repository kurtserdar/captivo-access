import { CopyButton } from "@/app/(app)/_shell/copy-button";

// The documented server-side upgrade command (manager + data-plane + auto
// migration). Kept as a single copy-pasteable line.
const SERVER_UPGRADE_COMMAND =
  "cd captivo-access/deploy && git pull && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d";

// Renders the "How to upgrade" card. Displays commands only — the app never runs
// them. `connectorCommand` is null when no connector is older than the manager.
export function UpgradeGuide({
  currentVersion,
  latestVersion,
  latestUrl,
  connectorCommand,
  outdatedConnectors,
}: {
  currentVersion: string;
  latestVersion: string;
  latestUrl: string | null;
  connectorCommand: string | null;
  outdatedConnectors: number;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>How to upgrade</h2>
      </div>
      <p className="cell-sub">
        Captivo Access <strong>v{latestVersion}</strong> is available — you&apos;re on{" "}
        <strong>v{currentVersion}</strong>.
        {latestUrl && (
          <>
            {" "}
            <a href={latestUrl} target="_blank" rel="noreferrer">
              Release notes
            </a>
            .
          </>
        )}
      </p>

      <div className="field">
        <label className="field-label">On your server</label>
        <p className="cell-sub">
          Upgrades the manager and data-plane and applies any schema change automatically.
        </p>
        <code className="code">{SERVER_UPGRADE_COMMAND}</code>
        <div className="row-actions">
          <CopyButton value={SERVER_UPGRADE_COMMAND} label="Copy command" />
        </div>
      </div>

      {connectorCommand && (
        <div className="field">
          <label className="field-label">On each connector host</label>
          <p className="cell-sub">
            {outdatedConnectors} connector{outdatedConnectors === 1 ? "" : "s"} older than the manager.
            Connectors run on separate machines, so run this once on each connector&apos;s host — the token
            volume is kept, so no re-pairing.
          </p>
          <code className="code">{connectorCommand}</code>
          <div className="row-actions">
            <CopyButton value={connectorCommand} label="Copy command" />
          </div>
        </div>
      )}
    </div>
  );
}
