import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listPlatformAdmins } from "@/lib/platform/admins";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { SectionHead } from "../../_shell/ui";
import { AdminRowActions, InviteAdminForm } from "./admins-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform admins" };

export default async function AdminsPage() {
  const { me, users, invites } = await withRequestTenant(async () => {
    const me = await requirePlatformAdmin();
    return { me, ...(await listPlatformAdmins()) };
  });
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Platform admins</h1>
          <p>Operators with full control over this platform. They sign in with passkeys at the platform console host; every action they take is recorded in the platform audit chain.</p>
        </div>
      </div>
      <div className="card">
        <SectionHead title="Operators" sub={`${users.length} account${users.length === 1 ? "" : "s"}`} />
        <div className="table-wrap"><table className="table"><thead><tr><th>Operator</th><th>Status</th><th>Passkeys</th><th>Sessions</th><th>Since</th><th></th></tr></thead><tbody>
          {users.map((u) => <tr key={u.id}><td>{u.name}{u.id === me.id ? <span className="cell-sub"> (you)</span> : null}<div className="cell-sub">{u.email}</div></td><td><span className={`pill ${u.status === "ACTIVE" ? "ok" : "neutral"}`}>{u.status}</span></td><td className="cell-sub">{u.passkeys}</td><td className="cell-sub">{u.sessions}</td><td className="cell-sub"><LocalTime iso={u.createdAt.toISOString()} mode="date" /></td><td><AdminRowActions id={u.id} isSelf={u.id === me.id} email={u.email} /></td></tr>)}
        </tbody></table></div>
      </div>
      <div className="dash-cols">
        <div className="card">
          <SectionHead title="Invite an operator" sub="They accept at the platform host and register a passkey." />
          <InviteAdminForm />
        </div>
        <div className="card">
          <SectionHead title="Open invites" />
          {invites.length === 0 ? <div className="empty">None.</div> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Email</th><th>Expires</th></tr></thead><tbody>
              {invites.map((i) => <tr key={i.id}><td>{i.name}<div className="cell-sub">{i.email}</div></td><td className="cell-sub"><LocalTime iso={i.expiresAt.toISOString()} mode="short" /></td></tr>)}
            </tbody></table></div>
          )}
        </div>
      </div>
    </section>
  );
}
