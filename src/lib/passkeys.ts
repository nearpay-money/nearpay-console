/**
 * Hardware-passkey ceremonies for the console (identity §8.1, spec `/ops/auth/*`) with
 * `@simplewebauthn/browser`. Registration options ask for a cross-platform (roaming) authenticator
 * with direct attestation; identity refuses keys whose AAGUID is not on the hardware allow-list
 * (`403 authenticator_not_allowed`). Only credentials registered through enrolment sign in.
 */
import {
  opsEnrolmentVerify,
  opsPasskeyAuthenticationOptions,
  opsPasskeyAuthenticationVerify,
  opsPasskeyRegistrationOptions,
  opsPasskeyRegistrationVerify,
  opsStepUpOptions,
  opsStepUpVerify,
} from "@nearpay-internal/spec";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { ApiClient } from "./api";
import type { OpsSession } from "./session";

type AuthOptionsJSON = Parameters<typeof startAuthentication>[0]["optionsJSON"];
type RegOptionsJSON = Parameters<typeof startRegistration>[0]["optionsJSON"];

export async function signInWithSecurityKey(api: ApiClient): Promise<OpsSession> {
  const options = await api.call(opsPasskeyAuthenticationOptions, { body: {} });
  const credential = await startAuthentication({ optionsJSON: options as unknown as AuthOptionsJSON });
  return api.call(opsPasskeyAuthenticationVerify, { body: { credential: credential as never } });
}

/** Exchanges the enrolment link token for a short-lived registration token (+ the operator email). */
export function verifyEnrolment(api: ApiClient, token: string) {
  return api.call(opsEnrolmentVerify, { body: { token } });
}

export async function registerSecurityKey(
  api: ApiClient,
  registrationToken: string,
  passkeyName?: string,
): Promise<OpsSession> {
  const options = await api.call(opsPasskeyRegistrationOptions, { body: { registration_token: registrationToken } });
  const credential = await startRegistration({ optionsJSON: options as unknown as RegOptionsJSON });
  return api.call(opsPasskeyRegistrationVerify, {
    body: {
      registration_token: registrationToken,
      credential: credential as never,
      ...(passkeyName ? { passkey_name: passkeyName } : {}),
    },
  });
}

/** A fresh step-up assertion (10 minutes); returns the refreshed session. */
export async function stepUpWithSecurityKey(api: ApiClient): Promise<OpsSession> {
  const options = await api.call(opsStepUpOptions, { body: {} });
  const credential = await startAuthentication({ optionsJSON: options as unknown as AuthOptionsJSON });
  return api.call(opsStepUpVerify, { body: { credential: credential as never } });
}

/** A user-facing message for WebAuthn errors raised by the browser (not the API). */
export function webAuthnBrowserError(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  const name = (e as { name?: string }).name;
  if (name === "NotAllowedError" || name === "AbortError")
    return "The security key prompt was closed or timed out. Try again and touch your key when it blinks.";
  if (name === "InvalidStateError") return "This security key is already registered. Sign in with it instead.";
  if (name === "SecurityError") return "Security keys only work on the console’s own address (HTTPS).";
  if (name === "NotSupportedError")
    return "This browser cannot use security keys. Use a current Chrome, Edge, Firefox or Safari.";
  return null;
}
