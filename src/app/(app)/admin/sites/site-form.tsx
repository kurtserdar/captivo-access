"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function errorMessage(code: string | undefined, isEdit: boolean): string {
  switch (code) {
    case "connector_name_upstream_required":
      return "Connector, name, and internal address are required.";
    case "invalid_hostname":
      return "A public hostname is required.";
    case "invalid_upstream_url":
      return "The internal address must be a valid http:// or https:// URL.";
    case "connector_not_found":
      return "Select a valid connector.";
    case "hostname_taken":
      return "That public hostname is already used by another site.";
    case "forbidden":
      return "Admin privileges are required for this action.";
    default:
      return isEdit ? "Couldn't save the site, please try again." : "Couldn't create the site, please try again.";
  }
}

type SiteInitial = {
  id: string;
  connectorId: string;
  name: string;
  hostname: string;
  upstreamUrl: string;
  description: string;
  insecureSkipVerify: boolean;
  recordSessions: boolean;
  clipboardMode: string;
  accessMode: "TRANSPARENT" | "GATEWAY";
  hasLogo?: boolean;
};

export function SiteForm({
  connectors,
  site,
  recordingEnabled = false,
  onDone,
}: {
  connectors: { id: string; name: string }[];
  site?: SiteInitial;
  recordingEnabled?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [connectorId, setConnectorId] = useState(site?.connectorId ?? connectors[0]?.id ?? "");
  const [name, setName] = useState(site?.name ?? "");
  const [hostname, setHostname] = useState(site?.hostname ?? "");
  const [upstreamUrl, setUpstreamUrl] = useState(site?.upstreamUrl ?? "");
  const [description, setDescription] = useState(site?.description ?? "");
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(site?.insecureSkipVerify ?? false);
  const [recordSessions, setRecordSessions] = useState(site?.recordSessions ?? false);
  const [clipboardMode, setClipboardMode] = useState(site?.clipboardMode ?? "allow");
  const [accessMode, setAccessMode] = useState<"TRANSPARENT" | "GATEWAY">(site?.accessMode ?? "TRANSPARENT");
  // logo: undefined = leave unchanged; null = remove; string = new base64 data URL.
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [logoType, setLogoType] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      setError("The logo must be 200 KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogo(typeof reader.result === "string" ? reader.result : null);
      setLogoType(file.type);
      setError(null);
    };
    reader.readAsDataURL(file);
  }
  function removeLogo() {
    setLogo(null);
    setLogoType(undefined);
  }
  // Whether to show a logo preview: a freshly-picked one, or the existing one
  // (unless the admin just removed it).
  const showNewLogo = typeof logo === "string";
  const showExistingLogo = logo === undefined && (site?.hasLogo ?? false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(site ? `/api/admin/sites/${site.id}` : "/api/admin/sites", {
        method: site ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId,
          name,
          hostname,
          upstreamUrl,
          description: description.trim() || undefined,
          insecureSkipVerify,
          recordSessions: accessMode === "GATEWAY" ? false : recordSessions,
          clipboardMode: accessMode === "GATEWAY" ? "allow" : clipboardMode,
          accessMode,
          logo,
          logoType,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || (site ? !result?.ok : !result?.id)) {
        setError(errorMessage(result?.error, !!site));
        return;
      }
      if (onDone) {
        onDone();
        router.refresh();
      } else if (site) {
        router.push("/admin/sites");
        router.refresh();
      } else {
        window.location.reload();
      }
    } catch {
      setError(site ? "Couldn't save the site, please try again." : "Couldn't create the site, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="site-connector">
          Connector
        </label>
        <select
          id="site-connector"
          className="select"
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          required
        >
          {connectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-name">
          Site name
        </label>
        <input
          id="site-name"
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. Internal wiki"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-hostname">
          Public hostname
        </label>
        <input
          id="site-hostname"
          type="text"
          className="input"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          required
          placeholder="wiki.access.example.com"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-upstream">
          Internal address
        </label>
        <input
          id="site-upstream"
          type="text"
          className="input"
          value={upstreamUrl}
          onChange={(e) => setUpstreamUrl(e.target.value)}
          required
          placeholder="http://10.0.5.20:8080"
        />
        <p className="hint">
          The real internal address this connector should reach (e.g. <code>http://10.0.5.20:8080</code>).
          It&apos;s stored on your Manager and sent to the connector over the tunnel; the connector dials it
          inside your network. To cap what a connector may reach, set <code>ALLOWED_TARGETS</code> on it.
        </p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-access-mode">
          Access mode
        </label>
        <select
          id="site-access-mode"
          className="select"
          value={accessMode}
          onChange={(e) => setAccessMode(e.target.value === "GATEWAY" ? "GATEWAY" : "TRANSPARENT")}
        >
          <option value="TRANSPARENT">Transparent web app</option>
          <option value="GATEWAY">Gateway (RDP/SSH/VNC via Guacamole)</option>
        </select>
        {accessMode === "GATEWAY" && (
          <p className="hint">
            Publish a Guacamole gateway (see <code>deploy/gateway/</code>) as this Site for recorded
            RDP/SSH/VNC access.
          </p>
        )}
      </div>
      <div className="field">
        <label className="field-label">
          <input
            type="checkbox"
            checked={insecureSkipVerify}
            onChange={(e) => setInsecureSkipVerify(e.target.checked)}
          />{" "}
          Allow self-signed certificate (skip TLS verification)
        </label>
        <span className="hint">
          Only for internal devices you trust — the certificate on the connector→app leg won&apos;t be verified.
        </span>
      </div>
      {recordingEnabled && accessMode !== "GATEWAY" && (
        <div className="field">
          <label className="field-label">
            <input
              type="checkbox"
              checked={recordSessions}
              onChange={(e) => setRecordSessions(e.target.checked)}
            />{" "}
            Record sessions (rrweb)
          </label>
          <span className="hint">
            Captures a replayable recording of vendor sessions on this site for audit purposes.
          </span>
        </div>
      )}
      {accessMode !== "GATEWAY" && (
        <div className="field">
          <label className="field-label" htmlFor="site-clipboard">Clipboard</label>
          <select id="site-clipboard" className="select" value={clipboardMode} onChange={(e) => setClipboardMode(e.target.value)}>
            <option value="allow">Allow copy &amp; paste</option>
            <option value="no_copy">Block copy out (no exfil)</option>
            <option value="no_paste">Block paste in</option>
            <option value="none">Block both</option>
          </select>
          <span className="hint">
            Restricts clipboard in the vendor&apos;s browser via injected script — a deterrent, not a hard
            control (bypassable if JavaScript is disabled). Gateway sites use Guacamole&apos;s own settings.
          </span>
        </div>
      )}
      {recordingEnabled && accessMode === "GATEWAY" && (
        <div className="field">
          <p className="hint">
            Gateway sessions are recorded by Guacamole itself, on the gateway host — see{" "}
            <code>deploy/gateway/</code>.
          </p>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor="site-logo">Logo (optional)</label>
        <div className="logo-field">
          {showNewLogo ? (
            <img className="logo-preview" src={logo as string} alt="" />
          ) : showExistingLogo && site ? (
            <img className="logo-preview" src={`/api/sites/${site.id}/logo`} alt="" />
          ) : (
            <span className="logo-preview logo-preview-empty" aria-hidden="true">—</span>
          )}
          <div className="logo-actions">
            <input id="site-logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onLogoFile} />
            {(showNewLogo || showExistingLogo) && (
              <button type="button" className="btn sm" onClick={removeLogo}>Remove</button>
            )}
          </div>
        </div>
        <p className="hint">PNG, JPG, SVG or WebP, up to 200 KB. Sites without a logo show a colored initial.</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-description">
          Description (optional)
        </label>
        <input
          id="site-description"
          type="text"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Saving…" : site ? "Save changes" : "Create site"}
      </button>
    </form>
  );
}
