import { requireUser } from "@/lib/current-user";
import { listUserRequests } from "@/lib/access/grants";
import { requestStatus, type RequestState } from "@/lib/portal/request-status";
import { RequestAccessButton } from "../access/request-access-button";
import { WithdrawRequestButton } from "../access/withdraw-request-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests" };

const BADGE: Record<RequestState, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "amber" },
  approved: { label: "Approved", cls: "teal" },
  denied: { label: "Denied", cls: "red" },
  withdrawn: { label: "Withdrawn", cls: "gray" },
  expired: { label: "Expired", cls: "gray" },
};

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}

export default async function RequestsPage() {
  const user = await requireUser();
  const now = new Date();
  const rows = await listUserRequests(user.id);
  return (
    <div className="vp-home">
      <div className="vp-head">
        <div>
          <h1 className="vp-greet">Access requests</h1>
          <p className="vp-sub">Your access requests and their status.</p>
        </div>
        <RequestAccessButton />
      </div>
      {rows.length === 0 ? (
        <div className="vp-empty">You haven&apos;t requested any access yet.</div>
      ) : (
        <div className="vp-cards">
          {rows.map((r) => {
            const st = requestStatus(
              { status: r.status, approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null, endsAt: r.endsAt ? r.endsAt.toISOString() : null },
              now,
            );
            const b = BADGE[st];
            const reason = st === "denied" ? r.denyReason : r.note;
            return (
              <div key={r.id} className="vp-req">
                <div className="vp-req-top">
                  <div className="vp-req-id">
                    <span className="vp-req-name">{r.site.name}</span>
                    <span className={`vp-badge ${b.cls}`}>{b.label}</span>
                  </div>
                  {st === "pending" && <WithdrawRequestButton id={r.id} />}
                </div>
                <div className="vp-req-meta">Requested {fmtDate(r.createdAt)}{reason ? ` · ${reason}` : ""}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
