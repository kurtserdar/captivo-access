import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { savePlatformSettings } from "@/lib/settings/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIntMin(v: unknown, min: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : null;
}

function toWebhook(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (typeof v !== "string" || v.trim() === "") return { ok: true, value: null };
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false };
    return { ok: true, value: v.trim() };
  } catch {
    return { ok: false };
  }
}

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  const webhook = toWebhook(body.notificationWebhookUrl);
  if (!webhook.ok) return NextResponse.json({ error: "invalid_webhook_url" }, { status: 400 });

  await savePlatformSettings({
    auditRetentionDays: toIntMin(body.auditRetentionDays, 0),
    inviteTtlHours: toIntMin(body.inviteTtlHours, 1),
    notificationWebhookUrl: webhook.value,
  });
  return NextResponse.json({ ok: true });
}
