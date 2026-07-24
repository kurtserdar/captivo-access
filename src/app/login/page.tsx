import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { LoginForm } from "./login-form";

// getCurrentUser() her istekte DB'den taze okunmalı.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main>
      <h1>Giriş yap</h1>
      <p>Cihazınızın passkey&apos;iyle giriş yapın.</p>
      <LoginForm />
    </main>
  );
}
