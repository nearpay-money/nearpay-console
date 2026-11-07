import { getAccount } from "@nearpay/spec";
import {
  createOpsSuspensionRequest,
  getOpsMerchant,
  getOpsSession,
  listOpsMerchants,
  opsLogout,
  opsPasskeyAuthenticationOptions,
  removeOpsBlocklistEntry,
} from "@nearpay-internal/spec";
import { describe, expect, it, vi } from "vitest";
import { ApiClient, encodeQuery } from "../../src/lib/api";
import { ApiError, friendlyError, isCode, StepUpCanceled } from "../../src/lib/errors";

const ACCT = "acct_01jbz9k3m4n5p6q7r8s9t0v1w2";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const errBody = (code: string, message = code) => ({ error: { type: "x", code, message, request_id: "req_1" } });

const session = {
  object: "ops_session",
  operator: { id: "usr_01jbz9k3m4n5p6q7r8s9t0v1w2", email: "riya@nearpay.money" },
  role: "ops",
  csrf_token: "c".repeat(43),
  step_up_until: null,
  idle_expires_at: 2_000_000_000,
  expires_at: 2_000_000_000,
};

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) {
  return new ApiClient({ base: "/api", fetch: fetchImpl, csrf: () => "csrf-token", uuid: () => "idem-1", ...extra });
}

describe("encodeQuery", () => {
  it("drops empty values, encodes arrays and keeps bracket keys", () => {
    expect(encodeQuery(undefined)).toBe("");
    expect(encodeQuery({ a: "", b: null, c: undefined })).toBe("");
    expect(encodeQuery({ limit: 20, "day[gte]": "2026-11-01", x: ["1", "2"] })).toBe(
      "?limit=20&day%5Bgte%5D=2026-11-01&x%5B%5D=1&x%5B%5D=2",
    );
  });
});

describe("ApiClient", () => {
  it("refuses non-console routes", async () => {
    const f = vi.fn();
    await expect(client(f).call(getAccount)).rejects.toThrow(/not a console route/);
    expect(f).not.toHaveBeenCalled();
  });

  it("GETs same-origin without CSRF, parses tolerantly and counts activity", async () => {
    const activity = vi.fn();
    const f = vi.fn(async () => json(200, session));
    const s = await client(f as unknown as typeof fetch, { activity }).call(getOpsSession);
    expect(s.role).toBe("ops");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ops/auth/session");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
    expect(activity).toHaveBeenCalledTimes(1);
  });

  it("anonymous calls do not count as activity", async () => {
    const activity = vi.fn();
    const f = vi.fn(async () => json(200, { challenge: "abc", rpId: "localhost" }));
    await client(f as unknown as typeof fetch, { activity }).call(opsPasskeyAuthenticationOptions, { body: {} });
    expect(activity).not.toHaveBeenCalled();
  });

  it("sends CSRF + Idempotency-Key on idempotent writes and builds paths", async () => {
    const f = vi.fn(async () => json(204, undefined));
    await client(f as unknown as typeof fetch).call(removeOpsBlocklistEntry, {
      params: { id: "bl_01jbz9k3m4n5p6q7r8s9t0v1w2" },
      body: { reason: "x" },
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ops/blocklist/bl_01jbz9k3m4n5p6q7r8s9t0v1w2/remove");
    const h = init.headers as Record<string, string>;
    expect(h["X-CSRF-Token"]).toBe("csrf-token");
    expect(h["Idempotency-Key"]).toBe("idem-1");
    expect(init.body).toBe(JSON.stringify({ reason: "x" }));
  });

  it("non-idempotent writes carry no Idempotency-Key; an empty 200 body is undefined", async () => {
    const f = vi.fn(async () => new Response("", { status: 200 }));
    const r = await client(f as unknown as typeof fetch, { csrf: () => undefined }).call(opsLogout, { body: {} });
    expect(r).toBeUndefined();
    const h = (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h["Idempotency-Key"]).toBeUndefined();
    expect(h["X-CSRF-Token"]).toBeUndefined();
  });

  it("replays once after step-up with the same Idempotency-Key", async () => {
    let n = 0;
    const uuid = vi.fn(() => `k${++n}`);
    const responses = [json(401, errBody("step_up_required")), json(201, { bad: true })];
    const f = vi.fn(async () => responses.shift() as Response);
    const stepUp = vi.fn(async () => {});
    await expect(
      client(f as unknown as typeof fetch, { stepUp, uuid }).call(createOpsSuspensionRequest, {
        params: { id: ACCT },
        body: { action: "suspend", reason: "r" },
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(stepUp).toHaveBeenCalledTimes(1);
    const keys = f.mock.calls.map(
      (c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys).toEqual(["k1", "k1"]);
    expect(uuid).toHaveBeenCalledTimes(1);
  });

  it("a canceled step-up sends nothing more", async () => {
    const f = vi.fn(async () => json(401, errBody("step_up_required")));
    const stepUp = vi.fn(async () => {
      throw new StepUpCanceled();
    });
    await expect(
      client(f as unknown as typeof fetch, { stepUp }).call(createOpsSuspensionRequest, {
        params: { id: ACCT },
        body: { action: "suspend", reason: "r" },
      }),
    ).rejects.toBeInstanceOf(StepUpCanceled);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a second step_up_required is not replayed again", async () => {
    const f = vi.fn(async () => json(401, errBody("step_up_required")));
    const stepUp = vi.fn(async () => {});
    await expect(
      client(f as unknown as typeof fetch, { stepUp }).call(createOpsSuspensionRequest, {
        params: { id: ACCT },
        body: { action: "suspend", reason: "r" },
      }),
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("session loss calls unauthenticated", async () => {
    for (const [status, code] of [
      [401, "authentication_required"],
      [403, "csrf_token_invalid"],
    ] as const) {
      const unauthenticated = vi.fn();
      const f = vi.fn(async () => json(status, errBody(code)));
      await expect(
        client(f as unknown as typeof fetch, { unauthenticated }).call(getOpsMerchant, { params: { id: ACCT } }),
      ).rejects.toMatchObject({ code });
      expect(unauthenticated).toHaveBeenCalledTimes(1);
    }
    const unauthenticated = vi.fn();
    const f = vi.fn(async () => json(403, errBody("approver_conflict")));
    await expect(
      client(f as unknown as typeof fetch, { unauthenticated }).call(getOpsMerchant, { params: { id: ACCT } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(unauthenticated).not.toHaveBeenCalled();
  });

  it("malformed JSON and contract breaks are invalid_response", async () => {
    const f1 = vi.fn(async () => new Response("{nope", { status: 200, headers: { "x-request-id": "req_9" } }));
    await expect(client(f1 as unknown as typeof fetch).call(getOpsSession)).rejects.toMatchObject({
      code: "invalid_response",
      requestId: "req_9",
    });
    const f2 = vi.fn(async () => json(200, { object: "list", data: [{ id: 1 }], has_more: false, url: "/x" }));
    await expect(client(f2 as unknown as typeof fetch).call(listOpsMerchants)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("keeps unknown open-enum values", async () => {
    const f = vi.fn(async () => json(200, { ...session, role: "ops" }));
    await expect(client(f as unknown as typeof fetch).call(getOpsSession)).resolves.toMatchObject({ role: "ops" });
  });
});

describe("ApiError / friendlyError", () => {
  it("parses the envelope, or falls back by status", async () => {
    const e = await ApiError.fromResponse(
      json(409, { error: { code: "state_conflict", message: "m", param: "p", type: "state_conflict" } }),
    );
    expect(e).toMatchObject({ code: "state_conflict", param: "p", type: "state_conflict" });
    const e5 = await ApiError.fromResponse(new Response("oops", { status: 502, headers: { "x-request-id": "req_x" } }));
    expect(e5).toMatchObject({ code: "api_error", type: "api_error", requestId: "req_x" });
    const e4 = await ApiError.fromResponse(new Response("", { status: 404 }));
    expect(e4).toMatchObject({ code: "http_error", type: "invalid_request_error" });
    const e6 = await ApiError.fromResponse(json(400, { error: { code: "x", message: "m" } }));
    expect(e6.type).toBe("api_error");
  });

  it("maps codes to console copy and keeps the API detail", () => {
    const f = friendlyError(
      new ApiError({ status: 403, type: "p", code: "approver_conflict", message: "needs another", requestId: "req_2" }),
    );
    expect(f.message).toMatch(/A different operator must approve/);
    expect(f.detail).toBe("needs another");
    expect(f.requestId).toBe("req_2");
    expect(
      friendlyError(new ApiError({ status: 403, type: "p", code: "authenticator_not_allowed", message: "x" })).message,
    ).toMatch(/hardware security key/);
    expect(friendlyError(new ApiError({ status: 503, type: "a", code: "weird", message: "boom" })).message).toMatch(
      /NearPay had a problem/,
    );
    const plain = friendlyError(new ApiError({ status: 400, type: "a", code: "unknown_code", message: "Server says" }));
    expect(plain).toMatchObject({ message: "Server says", detail: undefined });
    const same = friendlyError(
      new ApiError({
        status: 429,
        type: "a",
        code: "rate_limited",
        message: "Too many requests. Wait a moment and try again.",
      }),
    );
    expect(same.detail).toBeUndefined();
    expect(friendlyError(new StepUpCanceled()).message).toBe("Confirmation canceled.");
    expect(friendlyError(new TypeError("Failed to fetch")).code).toBe("network_error");
    expect(friendlyError(new Error("x")).message).toBe("x");
    expect(friendlyError("y").message).toBe("y");
    expect(isCode(new ApiError({ status: 1, type: "", code: "a", message: "" }), "a")).toBe(true);
    expect(isCode(new Error("a"), "a")).toBe(false);
  });
});
