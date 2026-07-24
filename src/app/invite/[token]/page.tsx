import { verifyInvite } from "@/lib/auth/invite";
import { InviteEnrollForm } from "./invite-enroll-form";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Yönetici",
  VENDOR: "Tedarikçi",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await verifyInvite(token);

  if (!invite) {
    return (
      <main>
        <h1>Geçersiz veya süresi dolmuş davet</h1>
        <p>Bu davet bağlantısı artık geçerli değil. Yöneticinizden yeni bir davet isteyin.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Davetinizi tamamlayın</h1>
      <p>
        {invite.name} ({invite.email}) — {ROLE_LABEL[invite.role] ?? invite.role} olarak davet edildiniz.
      </p>
      <p>Hesabınızı oluşturmak için cihazınızın passkey&apos;iyle kaydolun.</p>
      <InviteEnrollForm token={token} />
    </main>
  );
}
