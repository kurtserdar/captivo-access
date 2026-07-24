import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth/bootstrap";
import { SetupForm } from "./setup-form";

// hasAnyUser() her istekte DB'den taze okunmalı — build-time prerender
// (statik export) hem yanlış/eski sonuç üretir hem de DB'siz build'i kırar.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");

  return (
    <main>
      <h1>Hesabınızı oluşturun</h1>
      <p>
        Captivo Access henüz kurulmadı. İlk yönetici hesabını oluşturmak için
        adınızı ve e-posta adresinizi girip cihazınızın passkey&apos;iyle kaydolun.
      </p>
      <SetupForm />
    </main>
  );
}
