import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { webcrypto } from "node:crypto";

// pkijs needs a WebCrypto engine; Node's is under node:crypto.
pkijs.setEngine(
  "node",
  new pkijs.CryptoEngine({ name: "node", crypto: webcrypto as unknown as Crypto }),
);

const SHA256_OID = "2.16.840.1.101.3.4.2.1";

function toBuffer(ab: ArrayBuffer): Buffer {
  return Buffer.from(new Uint8Array(ab));
}

// A fresh ArrayBuffer holding exactly the bytes of `b` (avoids offset surprises
// when handing Node Buffers / typed-array views to asn1js and pkijs).
function ab(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

// buildTimeStampRequest builds a DER TimeStampReq over `digest` (the SHA-256 the
// TSA will attest — i.e. sha256(preimage)), with certReq so the TSA embeds its
// certificate for later signature verification.
export function buildTimeStampRequest(digest: Buffer): Buffer {
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID }),
      hashedMessage: new asn1js.OctetString({ valueHex: ab(new Uint8Array(digest)) }),
    }),
    certReq: true,
  });
  return toBuffer(req.toSchema().toBER(false));
}

// Extracts the TSTInfo from a SignedData whose eContent carries it.
function readTstInfo(signed: pkijs.SignedData): pkijs.TSTInfo {
  const eContent = signed.encapContentInfo.eContent;
  if (!eContent) throw new Error("token has no eContent");
  const parsed = asn1js.fromBER(ab(eContent.valueBlock.valueHexView));
  if (parsed.offset === -1) throw new Error("bad TSTInfo DER");
  return new pkijs.TSTInfo({ schema: parsed.result });
}

function signedDataFromToken(token: Buffer): pkijs.SignedData {
  const asn1 = asn1js.fromBER(ab(new Uint8Array(token)));
  if (asn1.offset === -1) throw new Error("bad token DER");
  const ci = new pkijs.ContentInfo({ schema: asn1.result });
  return new pkijs.SignedData({ schema: ci.content });
}

// parseTimeStampResponse reads a TimeStampResp, requires PKIStatus granted /
// grantedWithMods, and returns the embedded TimeStampToken (DER) + its genTime.
export function parseTimeStampResponse(der: Buffer): { token: Buffer; genTime: Date } {
  const asn1 = asn1js.fromBER(ab(new Uint8Array(der)));
  if (asn1.offset === -1) throw new Error("bad response DER");
  const resp = new pkijs.TimeStampResp({ schema: asn1.result });
  const status = resp.status.status;
  if (status !== 0 && status !== 1) throw new Error(`TSA did not grant (PKIStatus ${status})`);
  if (!resp.timeStampToken) throw new Error("response has no token");
  const tokenDer = toBuffer(resp.timeStampToken.toSchema().toBER(false));
  const signed = new pkijs.SignedData({ schema: resp.timeStampToken.content });
  const tst = readTstInfo(signed);
  return { token: tokenDer, genTime: tst.genTime };
}

// verifyTimeStampToken verifies that `token` is a validly-signed RFC 3161 token
// whose message imprint is sha256(`preimage`). pkijs's TSTInfo-aware verify does
// both in one step: it hashes `preimage`, compares to the token's imprint, and
// verifies the CMS signature against the embedded TSA certificate. A wrong
// preimage surfaces as an "imprint_mismatch"; a bad signature as
// "signature_invalid".
export async function verifyTimeStampToken(
  token: Buffer,
  preimage: Buffer,
): Promise<{ ok: boolean; genTime: Date | null; reason?: string }> {
  let signed: pkijs.SignedData;
  let genTime: Date | null = null;
  try {
    signed = signedDataFromToken(token);
    genTime = readTstInfo(signed).genTime;
  } catch {
    return { ok: false, genTime: null, reason: "parse_error" };
  }
  try {
    const res = await signed.verify({
      signer: 0,
      data: ab(new Uint8Array(preimage)),
      checkChain: false,
      extendedMode: true,
    });
    if (res.signatureVerified === true) return { ok: true, genTime };
    return { ok: false, genTime, reason: "signature_invalid" };
  } catch (e) {
    // pkijs throws "TSTInfo verification is failed" when the preimage's hash does
    // not match the token's imprint.
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, genTime, reason: /tstinfo/i.test(msg) ? "imprint_mismatch" : "signature_invalid" };
  }
}
