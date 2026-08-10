import { describe, it, expect } from "vitest";
import { inviteEmail, approvalRequestEmail, siteEventEmail, accessDecisionEmail } from "./templates";

describe("email templates", () => {
  it("inviteEmail embeds the link in html and text", () => {
    const m = inviteEmail({ name: "Deniz", link: "https://x.test/invite/abc" });
    expect(m.subject).toContain("invited");
    expect(m.html).toContain("https://x.test/invite/abc");
    expect(m.text).toContain("https://x.test/invite/abc");
  });
  it("approvalRequestEmail links to the console when a url is given", () => {
    const m = approvalRequestEmail({ vendorName: "A", vendorEmail: "a@x", siteName: "Grafana", consoleUrl: "https://c.test" });
    expect(m.html).toContain("https://c.test/admin/grants");
  });
  it("siteEventEmail omits the button when consoleUrl is empty", () => {
    const m = siteEventEmail({ type: "site_down", siteName: "Grafana", detail: "refused", consoleUrl: "" });
    expect(m.subject).toContain("Site down");
    expect(m.html).not.toContain("href=\"/admin/notifications\"");
  });
  it("escapes html in user-supplied values", () => {
    const m = inviteEmail({ name: "<script>x</script>", link: "https://x.test/i" });
    expect(m.html).not.toContain("<script>x</script>");
  });
  it("accessDecisionEmail (approved) names the site and links to My access", () => {
    const m = accessDecisionEmail({ decision: "approved", siteName: "Grafana", consoleUrl: "https://c.test" });
    expect(m.subject).toContain("approved");
    expect(m.subject).toContain("Grafana");
    expect(m.text).toContain("Grafana");
    expect(m.html).toContain("https://c.test/access");
  });
  it("accessDecisionEmail (denied) reads as a decline and omits the button with no url", () => {
    const m = accessDecisionEmail({ decision: "denied", siteName: "Grafana", consoleUrl: "" });
    expect(m.subject.toLowerCase()).toContain("declined");
    expect(m.html).not.toContain("href=\"/access\"");
  });
});
