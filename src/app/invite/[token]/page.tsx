import { verifyInvite } from "@/lib/auth/invite";
import { InviteEnrollForm } from "./invite-enroll-form";
import { BrandMark } from "@/components/brand";
import { ROLE_LABELS } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await verifyInvite(token);

  if (!invite) {
    return (
      <div className="auth">
        <div className="auth-card">
          <BrandMark size={34} className="auth-mark" />
          <h1>Invalid or expired invitation</h1>
          <p>This invite link is no longer valid. Ask your admin for a new invitation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <BrandMark size={34} className="auth-mark" />
        <h1>Complete your invitation</h1>
        <p>
          {invite.name} ({invite.email}) — you&apos;ve been invited as {ROLE_LABELS[invite.role] ?? invite.role}.
        </p>
        <p>Register with your device&apos;s passkey to create your account.</p>
        <InviteEnrollForm token={token} />
      </div>
    </div>
  );
}
