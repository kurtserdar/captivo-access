import { describe, it, expect } from "vitest";
import { createClipboardBridge } from "./clipboard";

function fakeGuacamole() {
  const sent: string[] = [];
  const readers: FakeStringReader[] = [];
  class FakeStringWriter {
    constructor(public stream: unknown) {}
    sendText(t: string) { sent.push(t); }
    sendEnd() {}
  }
  class FakeStringReader {
    ontext: ((t: string) => void) | null = null;
    onend: (() => void) | null = null;
    constructor(public stream: unknown) { readers.push(this); }
  }
  return { Guacamole: { StringWriter: FakeStringWriter, StringReader: FakeStringReader }, sent, readers };
}

function fakeClient() {
  const streams: string[] = [];
  return {
    onclipboard: null as ((stream: unknown, mimetype: string) => void) | null,
    createClipboardStream: (mimetype: string) => { streams.push(mimetype); return { mimetype }; },
    streams,
  };
}

const BOTH = { allowCopyOut: true, allowPasteIn: true };

describe("createClipboardBridge.pushLocal", () => {
  it("sends text via a text/plain clipboard stream when paste-in is allowed", () => {
    const { Guacamole, sent } = fakeGuacamole();
    const client = fakeClient();
    const b = createClipboardBridge(client, Guacamole, BOTH);
    b.pushLocal("hello");
    expect(sent).toEqual(["hello"]);
    expect(client.streams).toEqual(["text/plain"]);
  });

  it("no-ops when paste-in is blocked", () => {
    const { Guacamole, sent } = fakeGuacamole();
    const client = fakeClient();
    const b = createClipboardBridge(client, Guacamole, { allowCopyOut: true, allowPasteIn: false });
    b.pushLocal("hello");
    expect(sent).toEqual([]);
    expect(client.streams).toEqual([]);
  });

  it("dedupes identical consecutive text", () => {
    const { Guacamole, sent } = fakeGuacamole();
    const b = createClipboardBridge(fakeClient(), Guacamole, BOTH);
    b.pushLocal("x");
    b.pushLocal("x");
    b.pushLocal("y");
    expect(sent).toEqual(["x", "y"]);
  });

  it("ignores empty text", () => {
    const { Guacamole, sent } = fakeGuacamole();
    const b = createClipboardBridge(fakeClient(), Guacamole, BOTH);
    b.pushLocal("");
    expect(sent).toEqual([]);
  });
});

describe("createClipboardBridge remote read", () => {
  it("accumulates remote text from onclipboard and exposes it via getRemoteText", () => {
    const { Guacamole, readers } = fakeGuacamole();
    const client = fakeClient();
    const b = createClipboardBridge(client, Guacamole, BOTH);
    expect(b.getRemoteText()).toBe("");
    client.onclipboard!({}, "text/plain");
    const reader = readers[readers.length - 1];
    reader.ontext!("hello ");
    reader.ontext!("world");
    reader.onend!();
    expect(b.getRemoteText()).toBe("hello world");
  });

  it("ignores non-text clipboard mimetypes", () => {
    const { Guacamole, readers } = fakeGuacamole();
    const client = fakeClient();
    const b = createClipboardBridge(client, Guacamole, BOTH);
    client.onclipboard!({}, "image/png");
    expect(readers).toHaveLength(0);
    expect(b.getRemoteText()).toBe("");
  });
});
