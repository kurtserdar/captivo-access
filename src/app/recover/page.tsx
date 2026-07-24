import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { RecoverForm } from "./recover-form";

// getCurrentUser() her istekte DB'den taze okunmalı.
export const dynamic = "force-dynamic";

export default async function RecoverPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main>
      <h1>Hesabınızı kurtarın</h1>
      <p>
        E-posta adresinizi ve doğrulama uygulamanızdaki kurtarma kodunu girin.
        Doğrulanırsa bu cihaz için yeni bir passkey oluşturacağız.
      </p>
      <RecoverForm />
    </main>
  );
}
