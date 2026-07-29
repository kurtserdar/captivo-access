import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Captivo Access",
  description: "Open-source, self-hosted Zero Trust secure vendor access.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.dataset.theme = localStorage.getItem('ca-theme') || 'dark';`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
