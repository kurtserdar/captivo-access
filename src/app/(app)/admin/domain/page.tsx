import { requireCapability } from "@/lib/current-user";
import { promises as dns } from "node:dns";
import { accessDomain, wildcardRecord } from "@/lib/domain/custom-domain";
import { DomainVerifier } from "./domain-verifier";
import { CopyButton } from "@/app/(app)/_shell/copy-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Custom domain" };

export default async function AdminDomainPage() {
  await requireCapability("configure");

  const domain = accessDomain(process.env.MANAGER_PUBLIC_URL, process.env.ACCESS_DOMAIN);
  let serverIp: string | null = null;
  if (domain) {
    try {
      serverIp = (await dns.resolve4(`manager.${domain}`))[0] ?? null;
    } catch {
      serverIp = null;
    }
  }
  const record = domain ? wildcardRecord(domain) : "*.<your-access-domain>";
  const ip = serverIp ?? "<your-server-IP>";

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="page-title-row"><span className="page-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span><h1>Custom domain</h1></div>
          <p>Point one wildcard DNS record at this server; every vendor app then gets HTTPS automatically.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>1. Add this DNS record</h2></div>
        <p>At your DNS provider, add a single record — it covers every current and future app subdomain:</p>
        <div className="row-actions">
          <pre className="code"><code>{record}    A    {ip}</code></pre>
          {domain && <CopyButton value={record} label="Copy record" />}
        </div>
        {!domain && (
          <p className="cell-sub">
            Set <code>MANAGER_PUBLIC_URL</code> (e.g. https://manager.access.yourcompany.com) so we can show your exact values.
          </p>
        )}
        <p className="cell-sub">
          TLS is automatic — each app gets its certificate the first time it is opened. You only add this record once.
        </p>
      </div>

      <div className="card">
        <div className="card-head"><h2>2. Verify</h2></div>
        <DomainVerifier canVerify={!!domain} />
      </div>
    </main>
  );
}
