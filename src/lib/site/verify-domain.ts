import { promises as dns } from "node:dns";
import { classifyVerify, type VerifyStatus } from "@/lib/domain/custom-domain";

export function verifyDecision(expectedIp: string, resolvedIps: string[]): VerifyStatus {
  return classifyVerify(expectedIp, resolvedIps);
}

export async function resolve4(host: string): Promise<string[]> {
  try {
    return await dns.resolve4(host);
  } catch {
    return [];
  }
}

// The server IP tenants must point their domain at = the A record of the
// manager's own public host (MANAGER_PUBLIC_URL host).
export async function expectedServerIp(): Promise<string | null> {
  const raw = process.env.MANAGER_PUBLIC_URL;
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return null;
  }
  return (await resolve4(host))[0] ?? null;
}
