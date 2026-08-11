import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { appendAuditEvents } from "@/lib/audit/append";
import { LiveViewer } from "./live-viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live session" };

export default async function LiveSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "read_console")) notFound();
  const { sessionId } = await params;

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
      },
    ]);
  } catch {
    /* best-effort */
  }

  return <LiveViewer sessionId={sessionId} canControl={can(user.role, "configure")} />;
}
