import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const grant = await db.accessGrant.findUnique({
    where: { id },
    select: { userId: true, requiresApproval: true, approvedAt: true, status: true },
  });
  if (!grant || grant.userId !== user.id) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Only a still-pending request (awaiting approval) can be withdrawn.
  const isPending = grant.requiresApproval && !grant.approvedAt && grant.status === "ACTIVE";
  if (!isPending) return NextResponse.json({ error: "not_pending" }, { status: 409 });

  // Atomically delete only if still pending: if it was approved between the
  // read above and here, deleteMany matches 0 rows and we bail — never
  // deleting a grant that has since become active/approved.
  const deleted = await db.accessGrant.deleteMany({
    where: { id, userId: user.id, requiresApproval: true, approvedAt: null, status: "ACTIVE" },
  });
  if (deleted.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
