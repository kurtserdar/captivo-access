import { renderEmail, escapeHtml } from "./layout";

export function inviteEmail(input: { name: string; link: string }): { subject: string; html: string; text: string } {
  const subject = "You've been invited to Captivo Access";
  const { html, text } = renderEmail({
    heading: subject,
    bodyLines: [
      `Hi ${escapeHtml(input.name)},`,
      "You've been invited to reach internal applications through Captivo Access. Use the button below to set up your passkey and get started.",
      "This invite link is single-use and time-limited.",
    ],
    button: { label: "Open your invite", url: input.link },
  });
  return { subject, html, text };
}

export function approvalRequestEmail(input: {
  vendorName: string;
  vendorEmail: string;
  siteName: string;
  consoleUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Access request: ${input.siteName}`;
  const { html, text } = renderEmail({
    heading: "Access request pending review",
    bodyLines: [
      `${escapeHtml(input.vendorName)} (${escapeHtml(input.vendorEmail)}) requested access to ${escapeHtml(input.siteName)}.`,
      "It stays pending — and denied — until an admin approves it.",
    ],
    button: input.consoleUrl ? { label: "Review in the console", url: `${input.consoleUrl}/admin/grants` } : undefined,
  });
  return { subject, html, text };
}

export function siteEventEmail(input: {
  type: "site_down" | "site_recovered";
  siteName: string;
  detail: string | null;
  consoleUrl: string;
}): { subject: string; html: string; text: string } {
  const down = input.type === "site_down";
  const subject = down ? `Site down: ${input.siteName}` : `Site recovered: ${input.siteName}`;
  const line = down
    ? `Captivo Access can no longer reach ${escapeHtml(input.siteName)}${input.detail ? ` — ${escapeHtml(input.detail)}` : ""}.`
    : `${escapeHtml(input.siteName)} is reachable again.`;
  const { html, text } = renderEmail({
    heading: escapeHtml(subject),
    bodyLines: [line],
    button: input.consoleUrl ? { label: "View notifications", url: `${input.consoleUrl}/admin/notifications` } : undefined,
  });
  return { subject, html, text };
}
