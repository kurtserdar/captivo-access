"use client";
import { useState } from "react";
import { Modal } from "@/app/(app)/_shell/modal";
import { SiteForm } from "./site-form";

export function AddSiteButton({
  connectors,
  recordingEnabled,
  nativeGateway,
  isolationEnabled,
}: {
  connectors: { id: string; name: string }[];
  recordingEnabled: boolean;
  nativeGateway: boolean;
  isolationEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        Add resource
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add resource" size="lg">
        <SiteForm connectors={connectors} recordingEnabled={recordingEnabled} nativeGateway={nativeGateway} isolationEnabled={isolationEnabled} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
