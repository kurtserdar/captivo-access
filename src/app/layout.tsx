import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Captivo Access",
  description: "Open-source, self-hosted Zero Trust secure vendor access.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
