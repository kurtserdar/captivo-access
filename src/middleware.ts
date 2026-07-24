import { NextResponse, type NextRequest } from "next/server";

// NOT: SESSION_COOKIE burada @/lib/auth/session'dan import EDİLMEZ — o modül
// db.ts (Prisma) ve tokens.ts (@node-rs/argon2 native binding) zincirini
// sürüklüyor; middleware Edge runtime'da çalıştığı için bunlar build'i kırıyor
// (node:url / argon2 wasm export hataları). Sabiti burada literal tutuyoruz;
// session.ts'teki değerle senkron kalmalı ("ca_session").
const SESSION_COOKIE = "ca_session";

const PROTECTED = ["/settings", "/admin"]; // (app) altı
const PUBLIC = ["/login", "/recover", "/setup", "/invite", "/api/auth", "/api/health"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/")) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  const hasSession = !!req.cookies.get(SESSION_COOKIE)?.value;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/")) && !hasSession) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
