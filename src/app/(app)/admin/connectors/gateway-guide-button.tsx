"use client";
import { useState } from "react";
import { Modal } from "@/app/(app)/_shell/modal";
import { CommandBlock } from "@/app/(app)/_shell/command-block";

export function GatewayGuideButton({ managerUrl }: { managerUrl: string }) {
  const [open, setOpen] = useState(false);
  const base = managerUrl.replace(/\/+$/, "");
  const cmd = `curl -fsSL ${base}/gateway/install.sh | sh`;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Set up gateway
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Set up the recorded session gateway" size="lg">
        <p className="cell-sub" style={{ marginTop: 0 }}>
          The Guacamole gateway adds isolated, <b>recorded RDP/SSH/VNC</b> access. Run it on a host that
          already runs a connector — one command brings up the stack (guacd + Guacamole + Postgres).
        </p>
        <CommandBlock command={cmd} title="gateway-install" />
        <p className="cell-sub" style={{ marginTop: "1.1rem", marginBottom: ".5rem" }}>
          Then finish these steps (the installer can&apos;t automate them):
        </p>
        <ol className="guide-steps">
          <li>
            Open <code>http://127.0.0.1:8080/</code> on that host, sign in <code>guacadmin / guacadmin</code>,
            and <b>change that password</b>.
          </li>
          <li>Create an <b>RDP / SSH / VNC</b> connection with <b>Screen Recording</b> enabled.</li>
          <li>
            In Captivo → <a href="/admin/sites">Sites</a> → Add site: internal address{" "}
            <code>http://cap-guacamole:8080</code>, access mode <b>Gateway</b>.
          </li>
          <li>On this connector, enable <b>gateway mode</b> (its update command then joins the gateway network).</li>
        </ol>
        <p className="cell-sub">
          Single sign-on is on by default — vendors are auto-logged into the gateway, no second login.
        </p>
      </Modal>
    </>
  );
}
