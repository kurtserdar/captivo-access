"use client";
import { useState } from "react";
import { Modal } from "@/app/(app)/_shell/modal";
import { SiteForm } from "./site-form";
import type { SiteRow } from "./sites-view";

export function EditSiteButton({
  site,
  connectors,
  recordingEnabled,
}: {
  site: SiteRow;
  connectors: { id: string; name: string }[];
  recordingEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>
        Edit
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit site" size="lg">
        <SiteForm
          connectors={connectors}
          recordingEnabled={recordingEnabled}
          onDone={() => setOpen(false)}
          site={{
            id: site.id,
            connectorId: site.connectorId,
            name: site.name,
            hostname: site.hostname,
            upstreamUrl: site.upstreamUrl ?? "",
            description: site.description ?? "",
            insecureSkipVerify: site.insecureSkipVerify,
            recordSessions: site.recordSessions,
            clipboardMode: site.clipboardMode,
            accessMode: site.accessMode,
            hasLogo: site.hasLogo,
          }}
        />
      </Modal>
    </>
  );
}
