"use client";
import { useState } from "react";
import { Modal } from "@/app/(app)/_shell/modal";
import { SiteForm } from "./site-form";

export function AddSiteButton({
  connectors,
  recordingEnabled,
  nativeGateway,
}: {
  connectors: { id: string; name: string }[];
  recordingEnabled: boolean;
  nativeGateway: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        Add site
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add site" size="lg">
        <SiteForm connectors={connectors} recordingEnabled={recordingEnabled} nativeGateway={nativeGateway} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
