/**
 * Console session (lld/dashboard-and-console.md §2, identity §8.1). The cookie `__Host-np_ops`
 * (HttpOnly, host-only) is the credential; the `OpsSession` (CSRF token, role, expiries) lives in
 * memory only — nothing is written to web storage (no PII in the browser, repo AGENTS.md). A reload
 * or a new tab recovers it with `getOpsSession`.
 *
 * Expiry: identity ends a session after 30 min without activity or 12 h in total
 * (`OPS_SESSION_TTL_SECONDS`). The console mirrors that locally so it can warn before the end and
 * sign out cleanly at it; the server stays the authority (a `401` signs out at once).
 */

import { OPS_SESSION_TTL_SECONDS, type z } from "@nearpay/spec";
import { getOpsSession, type OpsSession as OpsSessionSchema } from "@nearpay-internal/spec";
import type { ApiClient } from "./api";
import { ApiError } from "./errors";

export type OpsSession = z.output<typeof OpsSessionSchema>;

/** Show the "session ending" warning this many seconds before the end. */
export const WARN_BEFORE_S = 120;

/**
 * When the session ends, in unix seconds: the later of the server's idle expiry and the last
 * successful authenticated call + idle TTL, capped by the absolute expiry.
 */
export function sessionEndsAt(
  s: Pick<OpsSession, "idle_expires_at" | "expires_at">,
  lastActivitySec: number | undefined,
  idleTtl: number = OPS_SESSION_TTL_SECONDS.idle,
): { at: number; reason: "idle" | "absolute" } {
  const idle = Math.max(s.idle_expires_at, lastActivitySec === undefined ? 0 : lastActivitySec + idleTtl);
  return idle < s.expires_at ? { at: idle, reason: "idle" } : { at: s.expires_at, reason: "absolute" };
}

export type ExpiryPhase = "active" | "warning" | "expired";

export function expiryPhase(endsAt: number, nowSec: number, warnBefore = WARN_BEFORE_S): ExpiryPhase {
  if (nowSec >= endsAt) return "expired";
  if (endsAt - nowSec <= warnBefore) return "warning";
  return "active";
}

/**
 * The current session from the cookie, or null when there is none (401) or it has ended. Other
 * failures (network, 5xx) are rethrown so the caller can tell "signed out" from "API unreachable".
 */
export async function restoreSession(
  api: Pick<ApiClient, "call">,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<OpsSession | null> {
  try {
    const s = await api.call(getOpsSession);
    return s.expires_at > nowSec ? s : null;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.code === "authentication_required")) return null;
    throw e;
  }
}

/** Safe in-app return path from `?next=` (same-origin paths only, never the auth pages). */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/signin") || next.startsWith("/auth/")) return "/";
  return next;
}

/** The token from an enrolment link fragment (`#token=…`), or null. */
export function tokenFromHash(hash: string): string | null {
  const t = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return t && t.length >= 16 && t.length <= 256 ? t : null;
}
