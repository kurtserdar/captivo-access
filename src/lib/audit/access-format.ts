// The four verbs stored in AuditEvent.method for gateway file transfers. Single
// source of truth on the TS side; the Go side mirrors these in
// dataplane/guacfiletransfer.go. Keep the two in sync.
export const TRANSFER_VERBS = ["DOWNLOAD", "UPLOAD", "DOWNLOAD-PARTIAL", "UPLOAD-PARTIAL"] as const;

export type TransferBadge = {
  isTransfer: boolean;
  direction?: "download" | "upload";
  partial?: boolean;
  label?: string;
};

// Maps an AuditEvent.method to a badge descriptor. Non-transfer methods (real
// HTTP verbs from the browser proxy) return { isTransfer: false }.
export function transferBadge(method: string): TransferBadge {
  switch (method) {
    case "DOWNLOAD":
      return { isTransfer: true, direction: "download", partial: false, label: "Download" };
    case "UPLOAD":
      return { isTransfer: true, direction: "upload", partial: false, label: "Upload" };
    case "DOWNLOAD-PARTIAL":
      return { isTransfer: true, direction: "download", partial: true, label: "Download (partial)" };
    case "UPLOAD-PARTIAL":
      return { isTransfer: true, direction: "upload", partial: true, label: "Upload (partial)" };
    default:
      return { isTransfer: false };
  }
}
