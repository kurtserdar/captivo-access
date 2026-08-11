import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { getVaultCredentialMeta } from "@/lib/vault/store";
import { SiteForm } from "../../site-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit resource" };

export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [site, connectors] = await Promise.all([
    db.site.findUnique({
      where: { id },
      select: { id: true, connectorId: true, name: true, hostname: true, upstreamUrl: true, description: true, insecureSkipVerify: true, recordSessions: true, clipboardMode: true, accessMode: true, logoType: true },
    }),
    db.connector.findMany({ where: { status: { not: "REVOKED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Seed the remote-desktop fields from the site's vault credential (secret excluded).
  const vault = site && site.accessMode === "GATEWAY" ? await getVaultCredentialMeta(site.id) : null;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Edit resource</h1>
          <p><Link href="/admin/sites">← Back to sites</Link></p>
        </div>
      </div>
      {!site ? (
        <div className="empty">Site not found.</div>
      ) : (
        <div className="card">
          <SiteForm
            connectors={connectors}
            recordingEnabled={recordingEnabled()}
            nativeGateway={nativeGatewayEnabled()}
            vault={vault ?? undefined}
            site={{
              id: site.id,
              connectorId: site.connectorId,
              name: site.name,
              hostname: site.hostname ?? "",
              upstreamUrl: site.upstreamUrl ?? "",
              description: site.description ?? "",
              insecureSkipVerify: site.insecureSkipVerify,
              recordSessions: site.recordSessions,
              clipboardMode: site.clipboardMode,
              accessMode: site.accessMode,
              hasLogo: site.logoType != null,
            }}
          />
        </div>
      )}
    </main>
  );
}
