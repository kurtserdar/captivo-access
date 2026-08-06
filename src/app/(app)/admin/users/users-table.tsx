"use client";

import { useState } from "react";
import { filterUsers, type UserFilter } from "@/lib/admin/filter-users";
import { ROLE_LABELS, ASSIGNABLE_ROLES } from "@/lib/auth/roles";
import { ToggleStatusButton } from "./toggle-status-button";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  company: string | null;
  phone: string | null;
  role: string;
  status: string;
  passkeys: number;
  isSelf: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  DISABLED: "Disabled",
};

const STATUS_PILL: Record<string, string> = {
  ACTIVE: "ok",
  DISABLED: "danger",
};

export function UsersTable({ users, initialQuery }: { users: UserRow[]; initialQuery: string }) {
  const [f, setF] = useState<UserFilter>({ q: initialQuery, status: "all", role: "all" });
  const shown = filterUsers(users, f);

  return (
    <div>
      <div className="filters">
        <input
          className="input"
          placeholder="Search name or email…"
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
        />
        <select
          className="select"
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value as UserFilter["status"] })}
        >
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <select
          className="select"
          value={f.role}
          onChange={(e) => setF({ ...f, role: e.target.value as UserFilter["role"] })}
        >
          <option value="all">All roles</option>
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="empty">No matching users.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Role</th>
                <th>Status</th>
                <th>Passkeys</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="cell-sub">{u.email}</td>
                  <td>
                    <div>{u.company ?? "—"}</div>
                    {u.phone && <div className="cell-sub">{u.phone}</div>}
                  </td>
                  <td>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[u.status] ?? "neutral"}`}>
                      {STATUS_LABEL[u.status] ?? u.status}
                    </span>
                  </td>
                  <td className="cell-sub">{u.passkeys}</td>
                  <td>
                    {u.isSelf ? (
                      <span className="cell-sub" title="You can't disable yourself">
                        (this account)
                      </span>
                    ) : (
                      <ToggleStatusButton userId={u.id} status={u.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
