"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";
import { CopyButton } from "@/app/(app)/_shell/copy-button";

type T = { id: string; slug: string; status: string; deleted: boolean };

// Header quick actions for a tenant. Destructive ones confirm first; every one
// is audited server-side in both the platform's and the tenant's admin chain.
export function TenantActions({ tenant }: { tenant: T }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [support, setSupport] = useState<{ open: boolean; reason: string; error: string | null }>({ open: false, reason: "", error: null });
  const [invite, setInvite] = useState<{ open: boolean; email: string; name: string; result: { inviteUrl: string; emailed: boolean } | null; error: string | null }>({ open: false, email: "", name: "", result: null, error: null });

  async function call(path: string, body?: unknown, label?: string) {
    setBusy(path); setMsg(null);
    try {
      const res = await fetch(`/api/platform/tenants/${tenant.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(`Failed: ${b?.error ?? res.status}`); return null; }
      if (label) setMsg(label);
      router.refresh();
      return b;
    } finally { setBusy(null); }
  }

  async function toggleStatus() {
    const next = tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    if (next === "SUSPENDED" && !(await confirm(`Suspend ${tenant.slug}? Its console and every app stop resolving and all sessions end. You can re-activate any time.`, { danger: true, confirmLabel: "Suspend" }))) return;
    await call("status", { status: next }, next === "SUSPENDED" ? "Tenant suspended." : "Tenant activated.");
  }
  async function forceLogout() {
    if (!(await confirm(`End every session in ${tenant.slug}? All admins and vendors will have to sign in again.`, { danger: true, confirmLabel: "End sessions" }))) return;
    const r = await call("logout", {}, undefined);
    if (r) setMsg(`${r.sessions} session${r.sessions === 1 ? "" : "s"} ended.`);
  }
  async function openSupport(e: React.FormEvent) {
    e.preventDefault();
    setBusy("support");
    try {
      const res = await fetch(`/api/platform/tenants/${tenant.id}/support`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: support.reason }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b?.url) { setSupport((s) => ({ ...s, error: b?.error === "reason_required" ? "Give a reason (it is shown to the tenant's admins in their audit log)." : `Couldn't start support access (${b?.error ?? res.status}).` })); return; }
      window.open(b.url, "_blank", "noopener");
      setSupport({ open: false, reason: "", error: null });
      setMsg("Support session opened in a new tab (1 hour).");
      router.refresh();
    } finally { setBusy(null); }
  }
  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("invite");
    try {
      const res = await fetch(`/api/platform/tenants/${tenant.id}/invite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: invite.email, name: invite.name }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setInvite((s) => ({ ...s, error: b?.error === "email_registered" ? "That email already has an account in this tenant." : b?.error === "invalid_email" ? "Enter a valid email." : "Couldn't create the invite." })); return; }
      setInvite((s) => ({ ...s, result: b, error: null }));
      router.refresh();
    } finally { setBusy(null); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <div className="row-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
        {!tenant.deleted && <button type="button" className="btn sm" onClick={() => setInvite((s) => ({ ...s, open: !s.open }))}>Invite admin</button>}
        {!tenant.deleted && <button type="button" className="btn sm" disabled={busy === "logout"} onClick={forceLogout}>End all sessions</button>}
        <a className="btn sm" href={`/api/platform/tenants/${tenant.id}/export`}>Export JSON</a>
        {!tenant.deleted && <button type="button" className={`btn sm ${tenant.status === "ACTIVE" ? "" : "primary"}`} disabled={busy === "status"} onClick={toggleStatus}>{tenant.status === "ACTIVE" ? "Suspend" : "Activate"}</button>}
        {!tenant.deleted && tenant.status === "ACTIVE" && <button type="button" className="btn sm primary" onClick={() => setSupport((s) => ({ ...s, open: !s.open }))}>Open as support</button>}
      </div>
      {msg && <span className="cell-sub">{msg}</span>}
      {support.open && (
        <form className="card" style={{ minWidth: 360 }} onSubmit={openSupport}>
          <div className="card-head bare"><h3>Open the tenant console as support</h3></div>
          <p className="cell-sub" style={{ marginBottom: 8 }}>Starts a 1-hour admin session in <b>{tenant.slug}</b> in a new tab, without touching your platform login. The tenant sees a &quot;Captivo Support&quot; user, a banner, and this reason in its audit log.</p>
          <div className="field"><label className="field-label">Reason</label><input className="input" required minLength={3} maxLength={300} placeholder="e.g. Ticket #412 — connector shows offline" value={support.reason} onChange={(e) => setSupport((s) => ({ ...s, reason: e.target.value }))} /></div>
          {support.error && <p className="notice error">{support.error}</p>}
          <div className="row-actions"><button className="btn primary sm" type="submit" disabled={busy === "support" || support.reason.trim().length < 3}>{busy === "support" ? "Opening…" : "Open console"}</button><button type="button" className="btn sm" onClick={() => setSupport({ open: false, reason: "", error: null })}>Cancel</button></div>
        </form>
      )}
      {invite.open && (
        <form className="card" style={{ minWidth: 360 }} onSubmit={sendInvite}>
          <div className="card-head bare"><h3>Invite an admin</h3></div>
          <div className="field"><label className="field-label">Email</label><input className="input" type="email" required value={invite.email} onChange={(e) => setInvite((s) => ({ ...s, email: e.target.value }))} /></div>
          <div className="field"><label className="field-label">Name (optional)</label><input className="input" value={invite.name} onChange={(e) => setInvite((s) => ({ ...s, name: e.target.value }))} /></div>
          {invite.error && <p className="notice error">{invite.error}</p>}
          {invite.result ? (
            <div>
              <p className="notice success">{invite.result.emailed ? "Invite emailed. " : "No email sent (tenant has no SMTP). "}Share the link if needed:</p>
              <div className="row-actions"><code className="code" style={{ fontSize: ".75rem", wordBreak: "break-all" }}>{invite.result.inviteUrl}</code><CopyButton value={invite.result.inviteUrl} /></div>
            </div>
          ) : (
            <div className="row-actions"><button className="btn primary sm" type="submit" disabled={busy === "invite"}>{busy === "invite" ? "Creating…" : "Create invite"}</button><button type="button" className="btn sm" onClick={() => setInvite({ open: false, email: "", name: "", result: null, error: null })}>Cancel</button></div>
          )}
        </form>
      )}
      {dialog}
    </div>
  );
}
