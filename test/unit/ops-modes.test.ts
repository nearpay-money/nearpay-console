/**
 * Adaptive two-person rule (single-operator extension of OpsApproval), Cloudflare Access session
 * extensions and the beta platform-passkey badge.
 */
import { describe, expect, it } from "vitest";
import { passkeyBadge, reauthUrl, usesAccess } from "../../src/lib/session";
import { canCompleteAlone, singleOperatorOf } from "../../src/lib/two-person";

const session = (extra: Record<string, unknown> = {}) =>
  ({
    object: "ops_session",
    operator: { id: "usr_01jbz9k3m4n5p6q7r8s9t0v1w2", email: "owner@nearpay.money" },
    role: "ops_admin",
    csrf_token: "x".repeat(43),
    step_up_until: null,
    idle_expires_at: 1,
    expires_at: 2,
    ...extra,
  }) as never;

describe("single-operator extension", () => {
  it("reads the server's extension, tolerating odd values", () => {
    expect(singleOperatorOf({})).toBeNull();
    expect(singleOperatorOf({ single_operator: null })).toBeNull();
    expect(singleOperatorOf({ single_operator: { used: false, available_at: 100, reason_min_length: 25 } })).toEqual({
      used: false,
      available_at: 100,
      reason_min_length: 25,
    });
    expect(singleOperatorOf({ single_operator: { used: "yes", available_at: "soon" } })).toEqual({
      used: false,
      available_at: null,
      reason_min_length: 20,
    });
  });

  it("the requester completes alone only after the wait, and never twice", () => {
    expect(canCompleteAlone(null, 100)).toBe(false);
    expect(canCompleteAlone({ used: false, available_at: 200, reason_min_length: 20 }, 100)).toBe(false);
    expect(canCompleteAlone({ used: false, available_at: 100, reason_min_length: 20 }, 100)).toBe(true);
    expect(canCompleteAlone({ used: false, available_at: null, reason_min_length: 20 }, 100)).toBe(true);
    expect(canCompleteAlone({ used: true, available_at: null, reason_min_length: 20 }, 100)).toBe(false);
  });
});

describe("session extensions", () => {
  it("Cloudflare Access mode and its same-origin re-login path", () => {
    expect(usesAccess(session())).toBe(false);
    expect(usesAccess(null)).toBe(false);
    expect(usesAccess(session({ auth_mode: "cloudflare_access" }))).toBe(true);
    expect(reauthUrl(session({ reauth_url: "/cdn-cgi/access/logout" }))).toBe("/cdn-cgi/access/logout");
    expect(reauthUrl(session({ reauth_url: "https://evil.example/" }))).toBe("/cdn-cgi/access/logout");
    expect(reauthUrl(session({ reauth_url: "//evil.example/" }))).toBe("/cdn-cgi/access/logout");
    expect(reauthUrl(undefined)).toBe("/cdn-cgi/access/logout");
  });

  it("the beta platform-passkey badge", () => {
    expect(passkeyBadge(session())).toBeNull();
    expect(passkeyBadge(session({ passkey: { policy: "hardware" } }))).toBeNull();
    expect(passkeyBadge(session({ passkey: { policy: "platform_beta" } }))).toBe("platform passkey — beta");
    expect(passkeyBadge(session({ passkey: { policy: "platform_beta", label: "x" } }))).toBe("x");
  });
});
