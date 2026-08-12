// Maps Site.clipboardMode to the two clipboard directions the gateway client
// enforces. copy-out = remote clipboard leaving the session to the vendor
// (gated by no_copy); paste-in = vendor clipboard entering the session (gated
// by no_paste). guacd enforces the same via disable-copy/disable-paste; this
// mirror keeps the browser client from doing pointless work and keeps the UI
// consistent. Unknown values stay permissive to match the "allow" default.
export interface ClipboardCaps {
  allowCopyOut: boolean;
  allowPasteIn: boolean;
}

export function clipboardCaps(mode: string): ClipboardCaps {
  return {
    allowCopyOut: mode !== "no_copy" && mode !== "none",
    allowPasteIn: mode !== "no_paste" && mode !== "none",
  };
}
