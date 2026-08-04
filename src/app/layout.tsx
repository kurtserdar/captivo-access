import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Captivo Access", template: "%s · Captivo Access" },
  description: "Open-source, self-hosted Zero Trust secure vendor access.",
  applicationName: "Captivo Access",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
    { media: "(prefers-color-scheme: light)", color: "#f6f8fb" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
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
