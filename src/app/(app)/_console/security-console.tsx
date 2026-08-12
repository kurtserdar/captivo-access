import Link from "next/link";
import type { ConsoleData } from "@/lib/console/data";
import { duration, expiresIn } from "@/lib/console/format";
import { DecisionButtons } from "@/app/(app)/admin/grants/decision-buttons";

function hhmm(ts: Date | string): string {
  return new Date(ts).toISOString().slice(11, 16);
}
function auditMsg(r: ConsoleData["audit"][number]): string {
  const who = r.userEmail ?? "—";
  const what = r.siteName ?? r.host ?? r.path ?? "";
  return `${who} · ${r.decision} · ${what}`.trim();
}

export function SecurityConsole({ data }: { data: ConsoleData }) {
  const now = new Date();
  const { kpis, live, pending, expiring, connectors, audit } = data;
  const cells: { label: string; value: number; tone: string }[] = [
    { label: "GRANTS", value: kpis.grants, tone: "" },
    { label: "LIVE", value: kpis.live, tone: "accent" },
    { label: "PENDING", value: kpis.pending, tone: "warn" },
    { label: "EXPIRING 24H", value: kpis.expiring24h, tone: "danger" },
    { label: "RECORDINGS 7D", value: kpis.recordings7d, tone: "" },
  ];

  return (
    <div className="sc">
      <div className="sc-kpis">
        {cells.map((c) => (
          <div key={c.label} className="sc-kpi">
            <div className="sc-kpi-label">{c.label}</div>
            <div className={`sc-kpi-value${c.tone ? " " + c.tone : ""}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <section className="sc-block">
        <div className="sc-head"><h2>Live sessions</h2><Link href="/admin/live" className="sc-more">All sessions →</Link></div>
        {live.length === 0 ? (
          <div className="sc-empty">No live sessions.</div>
        ) : (
          <div className="sc-live">
            {live.map((s) => (
              <div key={s.sessionId} className="sc-card">
                <div className="sc-card-top">
                  <span className="sc-chip">{s.protocol.toUpperCase()}</span>
                  {s.recorded && <span className="sc-rec"><span className="sc-dot" />REC {duration(s.startedAt, now)}</span>}
                </div>
                <div className="sc-card-name">{s.host}</div>
                <div className="sc-card-sub">{s.userLabel}{s.viewerCount > 0 ? ` · ${s.viewerCount} watching` : ""}</div>
                <div className="sc-thumb">live session</div>
                <Link href={`/live/${s.sessionId}`} className="sc-watch">Watch live</Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="sc-grid">
        <div className="sc-panel">
          <div className="sc-head"><h2>Pending requests</h2>{pending.length > 0 && <span className="sc-count">{pending.length}</span>}</div>
          {pending.length === 0 ? <div className="sc-empty">Nothing waiting.</div> : pending.map((p) => (
            <div key={p.id} className="sc-req">
              <div className="sc-req-t">{p.userLabel} → {p.siteName}</div>
              {p.detail && <div className="sc-req-d">{p.detail}</div>}
              <DecisionButtons grantId={p.id} />
            </div>
          ))}
        </div>

        <div className="sc-col">
          <div className="sc-panel">
            <div className="sc-head"><h2>Expiring soon</h2></div>
            {expiring.length === 0 ? <div className="sc-empty">Nothing expiring.</div> : expiring.map((e) => (
              <Link key={e.id} href="/admin/grants" className="sc-exp">
                <span className="sc-exp-t">{e.userLabel} → {e.siteName}</span>
                <span className="sc-exp-left">{expiresIn(e.endsAt, now)}</span>
              </Link>
            ))}
          </div>
          <div className="sc-panel">
            <div className="sc-head"><h2>Connectors</h2></div>
            {connectors.length === 0 ? <div className="sc-empty">No connectors.</div> : connectors.map((c) => (
              <div key={c.id} className="sc-conn">
                <span className={`sc-dot ${c.online ? "ok" : "down"}`} />
                <span className="sc-conn-name">{c.name}</span>
                <span className="sc-conn-state">{c.online ? "online" : "offline"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sc-panel">
          <div className="sc-head"><h2>Audit stream</h2></div>
          {audit.length === 0 ? <div className="sc-empty">No recent activity.</div> : audit.map((r) => (
            <div key={r.id} className="sc-audit">
              <span className="sc-audit-t">{hhmm(r.timestamp)}</span>
              <span className={`sc-audit-k ${r.decision === "ALLOW" ? "ok" : "deny"}`}>{r.decision}</span>
              <span className="sc-audit-m">{auditMsg(r)}</span>
            </div>
          ))}
          <div className="sc-morefoot"><Link href="/admin/audit" className="sc-more">Full audit log →</Link></div>
        </div>
      </div>
    </div>
  );
}
