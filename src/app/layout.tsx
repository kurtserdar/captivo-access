import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Captivo Access",
  description: "Açık kaynak, self-hosted Zero-Trust güvenli tedarikçi erişimi.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
