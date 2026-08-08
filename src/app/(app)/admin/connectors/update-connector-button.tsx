"use client";

import { useState } from "react";
import { Modal } from "@/app/(app)/_shell/modal";

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

  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>Update</button>
      <Modal open={open} onClose={() => { setOpen(false); setCopied(false); }} title="Update connector">
        <p className="cell-sub" style={{ marginTop: 0 }}>Run this on the connector&apos;s host. It keeps the connector&apos;s token, so no re-pairing.</p>
        <code className="code secret">{command}</code>
        <div className="row-actions">
          <button type="button" className="btn sm primary" onClick={copy}>{copied ? "Copied" : "Copy command"}</button>
          <button type="button" className="btn sm" onClick={() => { setOpen(false); setCopied(false); }}>Close</button>
        </div>
        {managerUrlIsLocal && (
          <p className="notice error" style={{ marginBottom: 0 }}>
            <code>MANAGER_URL</code> points at <code>localhost</code> — replace it with the manager&apos;s
            real address (set <code>MANAGER_PUBLIC_URL</code> in the server&apos;s <code>.env</code>).
          </p>
        )}
      </Modal>
    </>
  );
}
