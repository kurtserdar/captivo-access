"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/access", label: "My access" },
  { href: "/requests", label: "Requests" },
  { href: "/history", label: "History" },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link key={l.href} href={l.href} className={active ? "vp-navlink vp-navlink-active" : "vp-navlink"}>
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
