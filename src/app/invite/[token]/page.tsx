import { verifyInvite } from "@/lib/auth/invite";
import { InviteEnrollForm } from "./invite-enroll-form";
import { BrandMark } from "@/components/brand";
import { AuthShell } from "@/components/auth-shell";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { withRequestTenant } from "@/lib/tenant/request";
import { isPlaceholderName } from "@/lib/auth/display-name";

export const dynamic = "force-dynamic";

async function InvitePageImpl({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await verifyInvite(token);

  if (!invite) {
    return (
      <AuthShell>
        <BrandMark size={38} className="auth-mark" />
        <h1>Invalid or expired invitation</h1>
        <p>This invite link is no longer valid. Ask your admin for a new invitation.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <BrandMark size={38} className="auth-mark" />
      <h1>Complete your invitation</h1>
      <p>
        {invite.email} — you&apos;ve been invited as {ROLE_LABELS[invite.role] ?? invite.role}.
      </p>
      <p>Confirm your name, then register with your device&apos;s passkey to create your account.</p>
      <InviteEnrollForm token={token} initialName={isPlaceholderName(invite.name, invite.email) ? "" : invite.name} />
    </AuthShell>
  );
}

export default async function InvitePage(...args: Parameters<typeof InvitePageImpl>) {
  return withRequestTenant(() => InvitePageImpl(...args));
}
