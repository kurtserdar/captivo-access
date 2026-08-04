export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Email-client-safe: table layout, inline styles only, no external CSS/font/SVG.
// bodyLines are treated as trusted HTML — templates must escape user values first.
export function renderEmail(input: {
  heading: string;
  bodyLines: string[];
  button?: { label: string; url: string };
}): { html: string; text: string } {
  const body = input.bodyLines
    .map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#18202e">${l}</p>`)
    .join("");
  const button = input.button
    ? `<p style="margin:20px 0 0"><a href="${input.button.url}" style="display:inline-block;background:#3358d4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px">${input.button.label}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fb;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e7ef;border-radius:12px;overflow:hidden">
<tr><td style="padding:18px 24px;border-bottom:1px solid #e2e7ef;font-weight:700;font-size:16px;color:#18202e">Captivo <span style="color:#647083;font-weight:400">Access</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 14px;font-size:18px;color:#18202e">${input.heading}</h1>
${body}${button}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e7ef;font-size:12px;color:#94a0b1">Captivo Access · self-hosted secure vendor access</td></tr>
</table></td></tr></table></body></html>`;
  const textLines = [input.heading, "", ...input.bodyLines.map((l) => l.replace(/<[^>]+>/g, ""))];
  if (input.button) textLines.push("", `${input.button.label}: ${input.button.url}`);
  return { html, text: textLines.join("\n") };
}
