import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SplashForm } from "./splash-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branding" };

export default async function BrandingPage() {
  const user = await requireUser();
  if (!can(user.role, "configure")) notFound();
  const b = await db.brandingConfig.findUnique({ where: { id: "singleton" }, select: { splashImageType: true } });
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Branding</h1>
          <p>Customize how Captivo Access looks to your vendors.</p>
        </div>
      </div>
      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Connecting screen</h2>
        <p className="cell-sub" style={{ marginBottom: 12 }}>The image shown on the connecting screen while a remote-desktop or isolated-browser session starts. PNG, JPG, WebP, or animated GIF, up to 2 MB. Leave empty to show the default Captivo mark.</p>
        <SplashForm hasSplash={!!b?.splashImageType} />
      </section>
    </main>
  );
}
