import { describe, it, expect } from "vitest";
import { buildTransportOptions } from "./transport";

describe("buildTransportOptions", () => {
  it("maps fields with implicit TLS (secure=true)", () => {
    expect(buildTransportOptions({ host: "smtp.example.com", port: 465, secure: true, username: "u", password: "p" }))
      .toEqual({ host: "smtp.example.com", port: 465, secure: true, auth: { user: "u", pass: "p" } });
  });
  it("keeps secure=false (STARTTLS)", () => {
    expect(buildTransportOptions({ host: "h", port: 587, secure: false, username: "u", password: "p" }).secure).toBe(false);
  });
});
