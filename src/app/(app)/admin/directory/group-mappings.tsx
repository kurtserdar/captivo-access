"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GroupMappingRow } from "@/lib/directory/mappings";

type SiteOption = { id: string; name: string };

export function GroupMappings({ mappings, sites }: { mappings: GroupMappingRow[]; sites: SiteOption[] }) {
  const router = useRouter();
  const [groupDN, setGroupDN] = useState("");
  const [kind, setKind] = useState<"ROLE" | "SITE">("ROLE");
  const [role, setRole] = useState<"ADMIN" | "OPERATOR" | "AUDITOR">("OPERATOR");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/directory/mappings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupDN, kind, role: kind === "ROLE" ? role : null, siteId: kind === "SITE" ? siteId : null, enabled: true }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Could not add the mapping.");
      return;
    }
    setGroupDN("");
    router.refresh();
  }

  async function toggle(m: GroupMappingRow) {
    await fetch(`/api/admin/directory/mappings/${m.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !m.enabled }),
    });
    router.refresh();
  }

  async function remove(m: GroupMappingRow) {
    await fetch(`/api/admin/directory/mappings/${m.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="card">
      <h2>Group mappings</h2>
      <p className="cell-sub">
        Map an AD group DN to a console role or a site. At login, a user&apos;s role and site grants are reconciled
        to match their group membership; a directory-managed user in no mapped group is deprovisioned.
      </p>

      {mappings.length === 0 ? (
        <div className="empty">No mappings yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Group DN</th>
                <th>Target</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id}>
                  <td><code>{m.groupDN}</code></td>
                  <td>{m.kind === "ROLE" ? `Role: ${m.role}` : `Site: ${m.siteName ?? m.siteId}`}</td>
                  <td>
                    <button type="button" className="btn sm ghost" onClick={() => toggle(m)}>
                      {m.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="btn sm danger" onClick={() => remove(m)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={add}>
        <div className="field">
          <label className="field-label" htmlFor="gm-dn">Group name or DN</label>
          <input
            id="gm-dn"
            type="text"
            className="input"
            value={groupDN}
            onChange={(e) => setGroupDN(e.target.value)}
            placeholder="Captivo-Admins  (or full DN: CN=Captivo-Admins,OU=Groups,DC=corp,DC=local)"
            required
          />
        </div>
        <div className="field">
          <label className="form-check">
            <input type="radio" name="gm-kind" checked={kind === "ROLE"} onChange={() => setKind("ROLE")} /> Console role
          </label>
          <label className="form-check">
            <input type="radio" name="gm-kind" checked={kind === "SITE"} onChange={() => setKind("SITE")} /> Site access
          </label>
        </div>
        {kind === "ROLE" ? (
          <div className="field">
            <label className="field-label" htmlFor="gm-role">Role</label>
            <select id="gm-role" className="select" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "OPERATOR" | "AUDITOR")}>
              <option value="ADMIN">Admin</option>
              <option value="OPERATOR">Operator</option>
              <option value="AUDITOR">Auditor</option>
            </select>
          </div>
        ) : (
          <div className="field">
            <label className="field-label" htmlFor="gm-site">Site</label>
            <select id="gm-site" className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="row-actions">
          <button type="submit" className="btn primary" disabled={busy || (kind === "SITE" && sites.length === 0)}>
            {busy ? "Adding…" : "Add mapping"}
          </button>
        </div>
      </form>
    </div>
  );
}
