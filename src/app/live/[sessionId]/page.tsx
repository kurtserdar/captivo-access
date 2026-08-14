import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { appendAuditEvents } from "@/lib/audit/append";
import { clientIp } from "@/lib/request-ip";
import { LiveViewer } from "./live-viewer";
import { KasmLiveViewer } from "./kasm-live-viewer";
import { listActiveSessions } from "@/lib/dataplane/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live session" };

export default async function LiveSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "read_console")) notFound();
  const { sessionId } = await params;

  const h = await headers();
  try {
    await appendAuditEvents([
      {
        userId: user.id,
        host: "manager",
        method: "GET",
        path: `/live/${sessionId}`,
        status: 200,
        decision: "ALLOW",
        reason: "Admin opened a live session view",
        clientIp: clientIp(h),
        userAgent: h.get("user-agent") ?? undefined,
      },
    ]);
  } catch {
    /* best-effort */
  }

  const sessions = await listActiveSessions();
  const isolated = sessions.find((s) => s.sessionId === sessionId)?.kind === "isolated";
  const canControl = can(user.role, "configure");
  return isolated
    ? <KasmLiveViewer sessionId={sessionId} canControl={canControl} />
    : <LiveViewer sessionId={sessionId} canControl={canControl} />;
}
