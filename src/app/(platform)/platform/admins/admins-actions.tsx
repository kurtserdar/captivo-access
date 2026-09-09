"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";
import { CopyButton } from "@/app/(app)/_shell/copy-button";

export function AdminRowActions({ id, isSelf, email }: { id: string; isSelf: boolean; email: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(method: "DELETE" | "POST", path: string, prompt: string) {
    if (!(await confirm(prompt, { danger: true, confirmLabel: method === "DELETE" ? "Remove" : "End sessions" }))) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(path, { method });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(b?.error === "last_admin" ? "Can't remove the last operator." : b?.error === "cannot_remove_self" ? "You can't remove yourself." : `Failed (${b?.error ?? res.status}).`); return; }
      router.refresh();
    } finally { setBusy(false); }
  }
  return (
    <div className="row-actions">
      <button type="button" className="btn sm" disabled={busy} onClick={() => run("POST", `/api/platform/admins/${id}/logout`, `End every session of ${email}?`)}>End sessions</button>
      {!isSelf && <button type="button" className="btn sm danger" disabled={busy} onClick={() => run("DELETE", `/api/platform/admins/${id}`, `Remove ${email} as a platform operator? Their passkeys and sessions are deleted.`)}>Remove</button>}
      {err && <span className="notice error" style={{ margin: 0 }}>{err}</span>}
      {dialog}
    </div>
  );
}

export function InviteAdminForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inviteUrl: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setResult(null);
    try {
      const res = await fetch("/api/platform/admins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, name }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(b?.error === "email_registered" ? "That email already has a platform account." : "Enter a valid email."); return; }
      setResult(b); setEmail(""); setName("");
      router.refresh();
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <div className="field"><label className="field-label">Email</label><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label className="field-label">Name (optional)</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      {err && <p className="notice error">{err}</p>}
      {result && <div><p className="notice success">Invite created. Send this link to them (it is not emailed automatically):</p><div className="row-actions"><code className="code" style={{ fontSize: ".75rem", wordBreak: "break-all" }}>{result.inviteUrl}</code><CopyButton value={result.inviteUrl} /></div></div>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create invite"}</button>
    </form>
  );
}
