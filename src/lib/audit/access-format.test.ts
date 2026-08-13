import { describe, it, expect } from "vitest";
import { transferBadge, TRANSFER_VERBS } from "./access-format";

describe("transferBadge", () => {
  it("maps DOWNLOAD", () => {
    expect(transferBadge("DOWNLOAD")).toEqual({ isTransfer: true, direction: "download", partial: false, label: "Download" });
  });
  it("maps UPLOAD", () => {
    expect(transferBadge("UPLOAD")).toEqual({ isTransfer: true, direction: "upload", partial: false, label: "Upload" });
  });
  it("maps DOWNLOAD-PARTIAL as partial", () => {
    expect(transferBadge("DOWNLOAD-PARTIAL")).toEqual({ isTransfer: true, direction: "download", partial: true, label: "Download (partial)" });
  });
  it("maps UPLOAD-PARTIAL as partial", () => {
    expect(transferBadge("UPLOAD-PARTIAL")).toEqual({ isTransfer: true, direction: "upload", partial: true, label: "Upload (partial)" });
  });
  it("treats a normal HTTP method as not a transfer", () => {
    expect(transferBadge("GET")).toEqual({ isTransfer: false });
  });
  it("TRANSFER_VERBS holds exactly the four verbs", () => {
    expect([...TRANSFER_VERBS]).toEqual(["DOWNLOAD", "UPLOAD", "DOWNLOAD-PARTIAL", "UPLOAD-PARTIAL"]);
  });
});
