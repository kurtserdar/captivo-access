import { verifyInvite } from "@/lib/auth/invite";
import { InviteEnrollForm } from "./invite-enroll-form";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  VENDOR: "Vendor",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await verifyInvite(token);

  if (!invite) {
    return (
      <main>
        <h1>Invalid or expired invitation</h1>
        <p>This invite link is no longer valid. Ask your admin for a new invitation.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Complete your invitation</h1>
      <p>
        {invite.name} ({invite.email}) — you&apos;ve been invited as {ROLE_LABEL[invite.role] ?? invite.role}.
      </p>
      <p>Register with your device&apos;s passkey to create your account.</p>
      <InviteEnrollForm token={token} />
    </main>
  );
}
