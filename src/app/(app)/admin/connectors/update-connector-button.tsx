"use client";

import { useState } from "react";

// A guided, copy-only "Update" affordance for an outdated connector. Unlike
// Re-pair, the command keeps the connector's token volume — no re-pairing — so
// it needs no server call (the command is static, built once on the page).
export function UpdateConnectorButton({
  command,
  managerUrlIsLocal,
}: {
  command: string;
  managerUrlIsLocal: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>
        Update
      </button>
    );
  }

  return (
    <div role="status" className="notice">
      <p>Run this on the connector&apos;s host. It keeps the connector&apos;s token, so no re-pairing.</p>
      <code className="code secret">{command}</code>
      <div className="row-actions">
        <button type="button" className="btn sm ghost" onClick={copy}>
          {copied ? "Copied" : "Copy command"}
        </button>
        <button type="button" className="btn sm" onClick={() => { setOpen(false); setCopied(false); }}>
          Cancel
        </button>
      </div>
      {managerUrlIsLocal && (
        <p className="notice error">
          <code>MANAGER_URL</code> points at <code>localhost</code> — replace it with the manager&apos;s
          real address (set <code>MANAGER_PUBLIC_URL</code> in the server&apos;s <code>.env</code>).
        </p>
      )}
    </div>
  );
}
