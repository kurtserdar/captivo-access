import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { getRpId } from "./rp";

const RP_NAME = "Captivo Access";

export async function genRegistrationOptions(
  user: { id: string; email: string; name: string },
  existing: { credentialId: string; transports: string[] }[],
) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(),
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
}

export async function verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string, origin: string) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: getRpId(),
    requireUserVerification: false,
  });
}

export async function genAuthenticationOptions() {
  return generateAuthenticationOptions({ rpID: getRpId(), userVerification: "preferred" });
}

export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  origin: string,
  passkey: { credentialId: string; publicKey: Uint8Array; counter: number; transports: string[] },
) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: getRpId(),
    credential: {
      id: passkey.credentialId,
      // Buffer'ın altındaki ArrayBufferLike (SharedArrayBuffer olabilir) tipini
      // SimpleWebAuthn'ın beklediği Uint8Array<ArrayBuffer>'a daraltmak için kopyala.
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    },
    requireUserVerification: false,
  });
}
