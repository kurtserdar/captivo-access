import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branding" };

// Hidden for now: removed from the nav and this page 404s on direct navigation. The
// feature (custom connecting-screen splash — SplashForm, /api/admin/branding/splash,
// /api/branding/splash, BrandingConfig, ConnectSplash's custom-image path) stays in
// the codebase. Re-enable by restoring the nav entry in src/lib/nav/model.ts and
// reverting this file to render <SplashForm/>.
export default function BrandingPage() {
  notFound();
}
