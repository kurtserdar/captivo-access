import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { RecoverForm } from "./recover-form";

// getCurrentUser() must be read fresh from the DB on every request.
export const dynamic = "force-dynamic";

export default async function RecoverPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main>
      <h1>Recover your account</h1>
      <p>
        Enter your email address and the recovery code from your
        authenticator app. If verified, we&apos;ll create a new passkey for
        this device.
      </p>
      <RecoverForm />
    </main>
  );
}
