/**
 * Spec-driven, in-process mock of the console API for the E2E tests (Playwright interception of
 * `/api/**`). Each request is matched to an `OPS_ROUTES` route from `@nearpay-internal/spec` and
 * checked like the real stack: ops session cookie (an in-memory flag), CSRF on unsafe methods,
 * Idempotency-Key on idempotent writes, `opsRoles` against the operator's role, step-up freshness,
 * strict query/body validation against the route schemas. Every mocked response is validated
 * against the route's response schema (tolerant of open enums), so fixtures cannot drift from the
 * contract. Two-person rules are enforced server-side here as in compliance/sentinel. Calls are
 * recorded for assertions.
 */
import { randomBytes } from "node:crypto";
import { type AnyRoute, type OpsRole, pathMatcher, safeParseTolerant } from "@nearpay/spec";
import { OPS_ROUTES } from "@nearpay-internal/spec";
import type { Page, Route } from "@playwright/test";
import {
  auditEvent,
  blocklistEntry,
  type CaseT,
  complianceCase,
  execution,
  type FindingT,
  finding,
  iso,
  type KillSwitchT,
  type KybCaseT,
  killSwitch,
  kybCase,
  type MerchantT,
  merchant,
  NOW,
  newId,
  OP_ME,
  OP_OTHER,
  observation,
  type RunT,
  refund,
  run,
  type SuspensionT,
  suspension,
  USDC_BASE,
} from "./fixtures";

export interface Call {
  readonly routeId: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly query: Record<string, unknown>;
  readonly body: unknown;
}

type Reply = { status: number; body?: unknown };

const matchers = OPS_ROUTES.map((r) => ({ route: r, re: pathMatcher(r.path) }));

function parseQuery(search: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(search)) out[k] = v;
  return out;
}

const err = (status: number, type: string, code: string, message = code): Reply => ({
  status,
  body: {
    error: { type, code, message, doc_url: `https://docs.nearpay.money/errors/${code}`, request_id: newId("req") },
  },
});
const ok = (body?: unknown, status = 200): Reply => ({ status, body });
const b64u = (n: number) => randomBytes(n).toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);

function page<T>(url: string, all: readonly T[], q: Record<string, unknown>, key = "id") {
  const limit = Number(q.limit ?? 10);
  let start = 0;
  if (typeof q.starting_after === "string") {
    const i = all.findIndex((x) => (x as Record<string, unknown>)[key] === q.starting_after);
    start = i + 1;
  }
  const data = all.slice(start, start + limit);
  return { object: "list", data, has_more: start + limit < all.length, url };
}

export class MockApi {
  readonly calls: Call[] = [];
  readonly unexpected: string[] = [];
  signedIn = false;
  role: OpsRole = "ops_admin";
  /** The operator the browser is signed in as (switch to OP_OTHER to play the second approver). */
  operator: { id: `usr_${string}`; email: string } = OP_ME;
  csrf = b64u(32);
  stepUpUntil = 0;
  /** Adaptive two-person rule: the platform has one active ops admin (requests carry `single_operator`). */
  singleOperator = false;
  /** Console signs in through Cloudflare Access (session extensions `auth_mode`, `reauth_url`). */
  accessMode = false;
  /** Absolute session lifetime handed out at sign-in (seconds). */
  sessionTtl = 12 * 3600;
  idleTtl = 1800;
  /** Next sign-in / registration verify fails with this error code. */
  failNext: Record<string, { status: number; type: string; code: string } | undefined> = {};
  enrolTokens = new Map<string, "valid" | "used">([["enrol-token-0123456789abcdef", "valid"]]);

  acme = merchant({ display_name: "Acme Studio", verified_legal_name: "Acme Studio Ltd" });
  northstar = merchant({ display_name: "Northstar Labs", kyb_status: "pending", live_enabled: false });
  orbit = merchant({ display_name: "Orbit Tools", country: "DE" });
  merchants: MerchantT[] = [this.acme, this.northstar, this.orbit];
  suspensions = new Map<string, SuspensionT>(this.merchants.map((m) => [m.id, suspension(m.id)]));
  kyb: KybCaseT[] = [
    kybCase(this.northstar),
    // open onboarding (ADR-0024): decided by the system, no register number declared
    kybCase(this.acme, {
      status: "approved",
      decided_at: NOW - 30 * 86_400,
      decided_by: "system",
      decision_reason: "auto-approved: open onboarding (ADR-0024)",
      profile: { ...kybCase(this.acme).profile, registration_number: null },
    }),
  ];
  held = execution({ account_id: this.acme.id });
  succeeded = execution({
    account_id: this.orbit.id,
    state: "succeeded",
    held_reason: null,
    settled_amount: "8300000000",
    settlement: { ...execution({ account_id: this.orbit.id }).settlement, expected: "8300000000" },
    evidence: {
      chain: "eip155:8453",
      tx_hash: "0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f",
      block_ref: "23456789",
      recipient: "0x8f3cf7ad23cd3cadbd9735aff958023239c6d920",
      asset_id: USDC_BASE,
      amount: "8300000000",
      finality: "final",
      tier: "A",
      source: "watcher",
      observed_at: iso(NOW - 3600),
      explorer_url: "https://basescan.org/tx/0x5e6f",
    },
  });
  refundObj = refund();
  refundEx = execution({
    account_id: this.acme.id,
    kind: "refund",
    state: "settling",
    held_reason: null,
    reference: {
      payment_intent: this.refundObj.payment_intent,
      payment_attempt: null,
      refund: this.refundObj.id,
      refund_leg: 1,
    },
  });
  executions = { live: [this.held, this.succeeded, this.refundEx], test: [] as ReturnType<typeof execution>[] };
  observations = new Map([
    [
      this.held.id,
      [
        observation(this.held.id, { source: "quote", provider_status: null, observed_at: iso(NOW - 20 * 60) }),
        observation(this.held.id, {
          source: "submit",
          provider_status: "PENDING_DEPOSIT",
          observed_at: iso(NOW - 18 * 60),
        }),
        observation(this.held.id, { source: "hot_poll", observed_at: iso(NOW - 15 * 60) }),
      ],
    ],
    [
      this.succeeded.id,
      [
        observation(this.succeeded.id, {
          source: "watcher",
          provider_status: null,
          observed_at: iso(NOW - 3600),
          payload: { transfer: "0x5e6f", confirmations: 1 },
        }),
        // rails §8.12 (ADR-0022): the post-success finality re-check failed — flagged, never applied
        observation(this.succeeded.id, {
          source: "verifier",
          provider_status: null,
          applied: false,
          observed_at: iso(NOW - 1800),
          payload: {
            finality_recheck: { outcome: "failed", reason: "block hash changed at finality", tx_hash: "0x5e6f" },
          },
        }),
      ],
    ],
  ]);
  heldCase: CaseT = complianceCase({
    kind: "held_execution",
    account_id: this.acme.id,
    subject: { type: "execution", id: this.held.id },
    review: true,
  });
  runs: RunT[] = [
    run({ account_id: this.acme.id }, "12460000000", "12460000000"),
    run({ account_id: this.orbit.id }, "8300000000", "8051000000"),
    run({ account_id: this.northstar.id }, "4100000000", "4100000000"),
  ];
  cases: CaseT[] = [
    this.heldCase,
    complianceCase({
      kind: "reconciliation_diff",
      account_id: this.orbit.id,
      subject: { type: "reconciliation_run", id: (this.runs[1] as RunT).id },
      created: NOW - 35 * 60,
    }),
    complianceCase({
      kind: "screening_hit",
      account_id: this.northstar.id,
      severity: "low",
      subject: { type: "address", id: "0x000000000000000000000000000000000000beef" },
      created: NOW - 3 * 3600,
    }),
  ];
  blocklist = [blocklistEntry()];
  ks: KillSwitchT = killSwitch();
  ksLog = [
    {
      engaged: false,
      reason: "Released after incident review",
      actor: `${OP_OTHER.id}+${OP_ME.id}`,
      version: 4,
      created_at: NOW - 3 * 86_400,
    },
    { engaged: true, reason: "Provider incident", actor: OP_OTHER.id, version: 3, created_at: NOW - 4 * 86_400 },
  ];
  findings: FindingT[] = [finding({ execution_id: this.held.id, account_id: this.acme.id })];
  refunds = [this.refundObj];
  audit = [
    auditEvent({ action: "ops.signed_in", actor: { type: "operator", id: OP_OTHER.id }, created: NOW - 3600 }),
    auditEvent({
      action: "kyb.decided",
      account: this.acme.id,
      target: { type: "kyb_case", id: this.acme.id },
      details: { decision: "approved" },
      created: NOW - 30 * 86_400,
    }),
  ];

  async install(p: Page): Promise<void> {
    await p.route("**/api/**", (r) => this.handle(r));
  }

  callsTo(routeId: string): Call[] {
    return this.calls.filter((c) => c.routeId === routeId);
  }

  private record(
    action: string,
    target: { type: string; id: string } | null,
    account: string | null = null,
    details: Record<string, unknown> = {},
  ) {
    this.audit.unshift(
      auditEvent({
        action,
        target,
        account: account as `acct_${string}` | null,
        details,
        actor: { type: "operator", id: this.operator.id },
        created: nowS(),
      }),
    );
  }

  private async handle(r: Route): Promise<void> {
    const req = r.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, "");
    const m = matchers.find((x) => x.route.method === req.method() && x.re.test(path));
    if (!m) {
      this.unexpected.push(`${req.method()} ${path}`);
      await r.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify(err(404, "invalid_request_error", "resource_missing").body),
      });
      return;
    }
    const segs = path.split("/");
    const params: Record<string, string> = {};
    m.route.path.split("/").forEach((t, i) => {
      const k = t.match(/^\{([a-z_]+)\}$/)?.[1];
      if (k) params[k] = decodeURIComponent(segs[i] ?? "");
    });
    const headers = await req.allHeaders();
    const query = parseQuery(url.search);
    const raw = req.postData();
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    this.calls.push({ routeId: m.route.id, method: req.method(), path, headers, query, body });
    const reply = this.check(m.route, headers, params, query, body) ?? this.dispatch(m.route, params, query, body);
    if (reply.status < 300 && m.route.response) {
      const v = safeParseTolerant(m.route.response, reply.body);
      if (!v.success) throw new Error(`mock response for ${m.route.id} violates the spec: ${v.error.message}`);
    }
    await r.fulfill({
      status: reply.status,
      contentType: "application/json",
      headers: { "x-request-id": newId("req") },
      body: reply.body === undefined ? "" : JSON.stringify(reply.body),
    });
  }

  private check(
    route: AnyRoute,
    h: Record<string, string>,
    params: Record<string, string>,
    query: Record<string, unknown>,
    body: unknown,
  ): Reply | null {
    if (route.visibility !== "ops") return err(404, "invalid_request_error", "resource_missing");
    const anonymous = route.auth.includes("anonymous");
    if (!anonymous) {
      if (!this.signedIn) return err(401, "authentication_error", "authentication_required");
      if (route.method !== "GET" && h["x-csrf-token"] !== this.csrf)
        return err(403, "permission_error", "csrf_token_invalid");
      if (!route.opsRoles?.includes(this.role))
        return err(403, "permission_error", "permission_denied", `Your role cannot call ${route.id}.`);
    }
    if (route.method !== "GET" && route.idempotent && !h["idempotency-key"])
      return err(400, "invalid_request_error", "invalid_request", "Idempotency-Key required");
    if (route.params && !route.params.safeParse(params).success)
      return err(400, "invalid_request_error", "invalid_request", "bad path parameter");
    if (route.query) {
      const q = route.query.safeParse(query);
      if (!q.success)
        return err(
          400,
          "invalid_request_error",
          "invalid_request",
          `query: ${q.error.issues[0]?.path.join(".")} ${q.error.issues[0]?.message}`,
        );
    } else if (Object.keys(query).length)
      return err(400, "invalid_request_error", "invalid_request", "unexpected query");
    if (route.body) {
      const b = route.body.safeParse(body ?? {});
      if (!b.success)
        return err(
          400,
          "invalid_request_error",
          "invalid_request",
          `body: ${b.error.issues[0]?.path.join(".")} ${b.error.issues[0]?.message}`,
        );
    }
    if (route.stepUp && this.stepUpUntil <= nowS())
      return err(
        401,
        "authentication_error",
        "step_up_required",
        "This action needs a fresh passkey confirmation (step-up).",
      );
    return null;
  }

  sessionBody(signIn = true) {
    if (signIn) {
      this.signedIn = true;
      this.stepUpUntil = nowS() + 600; // sign-in counts as a step-up
    }
    const n = nowS();
    return {
      ...(this.accessMode ? { auth_mode: "cloudflare_access", reauth_url: "/cdn-cgi/access/logout" } : {}),
      object: "ops_session",
      operator: this.operator,
      role: this.role,
      csrf_token: this.csrf,
      step_up_until: this.stepUpUntil || null,
      idle_expires_at: Math.min(n + this.idleTtl, n + this.sessionTtl),
      expires_at: n + this.sessionTtl,
    };
  }

  private failure(routeId: string): Reply | null {
    const f = this.failNext[routeId];
    if (!f) return null;
    this.failNext[routeId] = undefined;
    return err(
      f.status,
      f.type,
      f.code,
      f.code === "authenticator_not_allowed"
        ? "Console passkeys must be hardware security keys on the allow-list."
        : f.code,
    );
  }

  private approval(
    action: "account.suspend" | "account.reinstate" | "kill_switch.release",
    target: { type: "account" | "kill_switch"; id: string },
    reason: string,
    ttl: number,
  ) {
    return {
      id: newId("opa"),
      object: "ops_approval" as const,
      action,
      target,
      reason,
      status: "pending" as const,
      requested_by: { id: this.operator.id, role: this.role },
      requested_at: nowS(),
      decided_by: null,
      decided_at: null,
      decision_note: null,
      expires_at: nowS() + ttl,
      ...(this.singleOperator ? { single_operator: { used: false, available_at: nowS(), reason_min_length: 20 } } : {}),
    };
  }

  private dispatch(route: AnyRoute, params: Record<string, string>, q: Record<string, unknown>, raw: unknown): Reply {
    const b = (raw ?? {}) as Record<string, unknown>;
    const live = q.livemode === undefined ? undefined : q.livemode === "true";
    const id = params.id ?? "";
    const exId = id as `ex_${string}`;
    switch (route.id) {
      // ------------------------------------------------------------------ auth
      case "opsPasskeyAuthenticationOptions":
      case "opsStepUpOptions":
        return ok({
          challenge: b64u(32),
          rpId: "localhost",
          timeout: 60_000,
          allowCredentials: [],
          userVerification: "required",
        });
      case "opsPasskeyAuthenticationVerify":
        return this.failure(route.id) ?? ok(this.sessionBody());
      case "opsStepUpVerify":
        this.stepUpUntil = nowS() + 600;
        return ok(this.sessionBody(false));
      case "opsEnrolmentVerify": {
        const st = this.enrolTokens.get(String(b.token));
        if (st === "used") return err(410, "invalid_request_error", "link_used", "This link was already used.");
        if (!st) return err(410, "invalid_request_error", "link_expired", "This link has expired.");
        return ok({
          object: "ops_registration",
          registration_token: b64u(32),
          email: "new.operator@nearpay.money",
          expires_at: nowS() + 300,
        });
      }
      case "opsPasskeyRegistrationOptions":
        return ok({
          challenge: b64u(32),
          rp: { id: "localhost", name: "NearPay Operations" },
          user: { id: b64u(16), name: "new.operator@nearpay.money", displayName: "new.operator@nearpay.money" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          timeout: 60_000,
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
            authenticatorAttachment: "cross-platform",
          },
          attestation: "direct",
        });
      case "opsPasskeyRegistrationVerify": {
        const f = this.failure(route.id);
        if (f) return f;
        for (const [t, s] of this.enrolTokens) if (s === "valid") this.enrolTokens.set(t, "used");
        this.operator = { id: newId("usr"), email: "new.operator@nearpay.money" };
        this.role = "ops";
        return ok(this.sessionBody());
      }
      case "getOpsSession":
        return ok(this.sessionBody(false));
      case "opsLogout":
        this.signedIn = false;
        return ok(undefined, 204);

      // ------------------------------------------------------------------ merchants
      case "listOpsMerchants": {
        let xs = this.merchants;
        if (typeof q.q === "string") {
          const s = q.q.toLowerCase();
          xs = xs.filter(
            (m) => m.id === q.q || m.display_name.toLowerCase().startsWith(s) || m.owners.some((o) => o.email === s),
          );
        }
        if (q.status) xs = xs.filter((m) => m.status === q.status);
        if (q.kyb_status) xs = xs.filter((m) => m.kyb_status === q.kyb_status);
        if (q.live_enabled) xs = xs.filter((m) => String(m.live_enabled) === q.live_enabled);
        return ok(page("/v1/ops/merchants", xs, q));
      }
      case "getOpsMerchant": {
        const m = this.merchants.find((x) => x.id === id);
        return m ? ok(m) : err(404, "invalid_request_error", "resource_missing", `No such account: ${id}`);
      }
      case "getOpsMerchantSuspension": {
        const s = this.suspensions.get(id);
        return s ? ok(s) : err(404, "invalid_request_error", "resource_missing");
      }
      case "createOpsSuspensionRequest": {
        const s = this.suspensions.get(id);
        if (!s) return err(404, "invalid_request_error", "resource_missing");
        if (s.pending_request) return err(409, "state_conflict", "state_conflict", "A request is already pending.");
        const action = b.action === "suspend" ? "account.suspend" : "account.reinstate";
        if ((action === "account.suspend") === s.suspended)
          return err(409, "state_conflict", "state_conflict", "The account is already in that state.");
        const a = this.approval(action, { type: "account", id }, String(b.reason), 86_400);
        s.pending_request = a;
        this.record("account.action_requested", { type: "account", id }, id, { action });
        return ok(a, 201);
      }
      case "approveOpsSuspensionRequest": {
        const s = this.suspensions.get(id);
        const a = s?.pending_request;
        if (!s || !a || a.id !== params.request) return err(409, "state_conflict", "state_conflict");
        const solo = (a as { single_operator?: unknown }).single_operator !== undefined;
        if (solo && a.requested_by.id === this.operator.id && String(b.note ?? "").trim().length < 20)
          return err(400, "invalid_request_error", "parameter_invalid", "A written reason is required.");
        if (a.requested_by.id === this.operator.id && !solo)
          return err(
            403,
            "permission_error",
            "approver_conflict",
            "This approval needs a different approver: the requester cannot approve their own request.",
          );
        s.suspended = a.action === "account.suspend";
        s.reason = a.reason;
        s.actor = `${a.requested_by.id}+${this.operator.id}`;
        s.updated_at = nowS();
        s.pending_request = null;
        const m = this.merchants.find((x) => x.id === id);
        if (m) m.status = s.suspended ? "suspended" : "active";
        this.record(s.suspended ? "account.suspended" : "account.reinstated", { type: "account", id }, id);
        return ok(s);
      }
      case "rejectOpsSuspensionRequest": {
        const s = this.suspensions.get(id);
        const a = s?.pending_request;
        if (!s || !a || a.id !== params.request) return err(409, "state_conflict", "state_conflict");
        s.pending_request = null;
        return ok({
          ...a,
          status: "rejected",
          decided_by: { id: this.operator.id, role: this.role },
          decided_at: nowS(),
          decision_note: String(b.note),
        });
      }

      // ------------------------------------------------------------------ KYB
      case "listOpsKybCases": {
        const status = q.status ?? "pending";
        let xs = this.kyb.filter((k) => k.status === status);
        if (q.account) xs = xs.filter((k) => k.account_id === q.account);
        return ok(page("/v1/ops/kyb_cases", xs, q, "account_id"));
      }
      case "getOpsKybCase": {
        const k = this.kyb.find((x) => x.account_id === id);
        return k ? ok(k) : err(404, "invalid_request_error", "resource_missing");
      }
      case "decideOpsKybCase": {
        const k = this.kyb.find((x) => x.account_id === id);
        if (!k) return err(404, "invalid_request_error", "resource_missing");
        const decision = b.decision as KybCaseT["status"];
        if (decision === "approved" && k.status !== "pending" && k.status !== "rejected")
          return err(409, "state_conflict", "state_conflict", "Only pending or rejected cases may be approved.");
        k.status = decision;
        k.decision_reason = String(b.reason);
        k.decided_by = this.operator.id;
        k.decided_at = nowS();
        k.requested_info = decision === "needs_info" ? String(b.requested_info) : k.requested_info;
        k.history = [...k.history, { status: decision, actor: this.operator.id, reason: String(b.reason), at: nowS() }];
        const m = this.merchants.find((x) => x.id === id);
        if (m) m.kyb_status = decision;
        this.record("kyb.decided", { type: "kyb_case", id }, id, { decision });
        return ok(k);
      }

      // ------------------------------------------------------------------ cases
      case "listOpsCases": {
        let xs = this.cases.filter((c) => (q.status ? c.status === q.status : c.status !== "closed"));
        if (q.kind) xs = xs.filter((c) => c.kind === q.kind);
        if (q.severity) xs = xs.filter((c) => c.severity === q.severity);
        if (q.account) xs = xs.filter((c) => c.account_id === q.account);
        if (q.assignee) xs = xs.filter((c) => c.assignee === q.assignee);
        if (live !== undefined) xs = xs.filter((c) => c.livemode === live);
        return ok(
          page(
            "/v1/ops/cases",
            xs.map(({ events: _e, ...c }) => c),
            q,
          ),
        );
      }
      case "getOpsCase": {
        const c = this.cases.find((x) => x.id === id);
        return c ? ok(c) : err(404, "invalid_request_error", "resource_missing");
      }
      case "assignOpsCase":
      case "commentOpsCase":
      case "closeOpsCase": {
        const c = this.cases.find((x) => x.id === id);
        if (!c) return err(404, "invalid_request_error", "resource_missing");
        if (c.status === "closed") return err(409, "state_conflict", "state_conflict", "The case is closed.");
        const events = c.events ?? [];
        if (route.id === "assignOpsCase") {
          c.assignee = (b.assignee as CaseT["assignee"]) ?? null;
          if (c.status === "open" && c.assignee) c.status = "investigating";
          events.push({
            actor: this.operator.id,
            action: c.assignee ? "assigned" : "unassigned",
            note: null,
            at: nowS(),
          });
        } else if (route.id === "commentOpsCase") {
          events.push({ actor: this.operator.id, action: "commented", note: String(b.note), at: nowS() });
        } else {
          c.status = "closed";
          c.resolution = b.resolution as CaseT["resolution"];
          c.closed_at = nowS();
          events.push({ actor: this.operator.id, action: "closed", note: String(b.note), at: nowS() });
        }
        c.events = events;
        this.record(
          `case.${route.id.replace("OpsCase", "").replace(/^./, (s) => s)}`,
          { type: "compliance_case", id },
          c.account_id,
        );
        return ok(c);
      }

      // ------------------------------------------------------------------ blocklist / screening
      case "listOpsBlocklist": {
        let xs = this.blocklist;
        if (q.subject_type) xs = xs.filter((e) => e.subject_type === q.subject_type);
        if (q.subject) xs = xs.filter((e) => e.subject === String(q.subject).toLowerCase());
        return ok(page("/v1/ops/blocklist", xs, q));
      }
      case "addOpsBlocklistEntry": {
        const subject = String(b.subject).toLowerCase();
        if (this.blocklist.some((e) => e.subject === subject))
          return err(409, "state_conflict", "state_conflict", "Already blocked.");
        const e = blocklistEntry({
          subject_type: b.subject_type as "address",
          chain: (b.chain as string | undefined) ?? null,
          subject,
          reason: String(b.reason),
          created_by: this.operator.id,
          created: nowS(),
        });
        this.blocklist = [e, ...this.blocklist];
        this.record("blocklist.added", { type: "blocklist_entry", id: e.id });
        return ok(e, 201);
      }
      case "removeOpsBlocklistEntry":
        this.blocklist = this.blocklist.filter((e) => e.id !== id);
        this.record("blocklist.removed", { type: "blocklist_entry", id });
        return ok(undefined, 204);
      case "createOpsScreening": {
        const hit = this.blocklist.some((e) => e.subject === String(b.subject).toLowerCase());
        return ok({
          screening_id: newId("scr"),
          decision: hit ? "block" : "allow",
          risk: null,
          reasons: hit ? ["blocklist"] : [],
          cached: false,
          post_screen_required: false,
          provider: b.livemode ? "local" : "sandbox",
        });
      }
      case "createOpsRescreen":
        return ok({ job_id: newId("job"), destinations: 7 }, 202);

      // ------------------------------------------------------------------ sentinel
      case "getOpsKillSwitch":
        return ok(this.ks);
      case "engageOpsKillSwitch":
        if (!this.ks.engaged) {
          this.ks = {
            ...this.ks,
            engaged: true,
            reason: String(b.reason),
            actor: this.operator.id,
            updated_at: iso(nowS()),
            version: this.ks.version + 1,
            pending_release: null,
          };
          this.ksLog.unshift({
            engaged: true,
            reason: String(b.reason),
            actor: this.operator.id,
            version: this.ks.version,
            created_at: nowS(),
          });
        }
        return ok(this.ks);
      case "requestOpsKillSwitchRelease": {
        if (!this.ks.engaged || this.ks.pending_release) return err(409, "state_conflict", "state_conflict");
        const a = this.approval(
          "kill_switch.release",
          { type: "kill_switch", id: newId("ks") },
          String(b.reason),
          3600,
        );
        this.ks = { ...this.ks, pending_release: a };
        return ok(a, 201);
      }
      case "approveOpsKillSwitchRelease": {
        const a = this.ks.pending_release;
        if (!a || a.id !== id) return err(409, "state_conflict", "state_conflict");
        if (a.requested_by.id === this.operator.id)
          return err(
            403,
            "permission_error",
            "approver_conflict",
            "This approval needs a different approver: the requester cannot approve their own request.",
          );
        this.ks = {
          ...this.ks,
          engaged: false,
          reason: a.reason,
          actor: `${a.requested_by.id}+${this.operator.id}`,
          updated_at: iso(nowS()),
          version: this.ks.version + 1,
          pending_release: null,
        };
        this.ksLog.unshift({
          engaged: false,
          reason: a.reason,
          actor: this.ks.actor,
          version: this.ks.version,
          created_at: nowS(),
        });
        return ok(this.ks);
      }
      case "rejectOpsKillSwitchRelease": {
        const a = this.ks.pending_release;
        if (!a || a.id !== id) return err(409, "state_conflict", "state_conflict");
        this.ks = { ...this.ks, pending_release: null };
        return ok({
          ...a,
          status: "rejected",
          decided_by: { id: this.operator.id, role: this.role },
          decided_at: nowS(),
          decision_note: String(b.note),
        });
      }
      case "listOpsKillSwitchLog": {
        const before = q.before_version ? Number(q.before_version) : Number.POSITIVE_INFINITY;
        const xs = this.ksLog.filter((e) => e.version < before);
        const limit = Number(q.limit ?? 10);
        return ok({
          object: "list",
          data: xs.slice(0, limit),
          has_more: xs.length > limit,
          url: "/v1/ops/kill_switch/log",
        });
      }
      case "listOpsFindings": {
        let xs = this.findings;
        if (q.result) xs = xs.filter((f) => f.result === q.result);
        else xs = xs.filter((f) => f.result !== "pass");
        if (q.acknowledged) xs = xs.filter((f) => (f.acknowledged_at !== null) === (q.acknowledged === "true"));
        if (live !== undefined) xs = xs.filter((f) => f.livemode === live);
        return ok(page("/v1/ops/findings", xs, q));
      }
      case "getOpsFinding": {
        const f = this.findings.find((x) => x.id === id);
        return f ? ok(f) : err(404, "invalid_request_error", "resource_missing");
      }
      case "acknowledgeOpsFinding": {
        const f = this.findings.find((x) => x.id === id);
        if (!f) return err(404, "invalid_request_error", "resource_missing");
        if (f.acknowledged_at) return err(409, "state_conflict", "state_conflict");
        Object.assign(f, {
          acknowledged_at: nowS(),
          acknowledged_by: this.operator.id,
          acknowledgement_note: String(b.note),
        });
        return ok(f);
      }

      // ------------------------------------------------------------------ rails
      case "listOpsExecutions": {
        let xs = live ? this.executions.live : this.executions.test;
        if (q.state) xs = xs.filter((e) => e.state === q.state);
        if (q.held_reason) xs = xs.filter((e) => e.held_reason === q.held_reason);
        if (q.kind) xs = xs.filter((e) => e.kind === q.kind);
        if (q.account) xs = xs.filter((e) => e.account_id === q.account);
        if (q.deposit_address) xs = xs.filter((e) => e.deposit?.address === q.deposit_address);
        return ok(page("/v1/ops/executions", xs, q));
      }
      case "getOpsExecution": {
        const e = [...this.executions.live, ...this.executions.test].find((x) => x.id === id);
        return e ? ok(e) : err(404, "invalid_request_error", "resource_missing");
      }
      case "listOpsExecutionObservations":
        return ok({ data: this.observations.get(exId) ?? [], has_more: false });
      case "reverifyOpsExecution": {
        const e = [...this.executions.live, ...this.executions.test].find((x) => x.id === id);
        if (!e) return err(404, "invalid_request_error", "resource_missing");
        if (e.state !== "held" && e.state !== "verifying") return err(409, "state_conflict", "state_conflict");
        // never forces a state: records an operator observation only
        const list = this.observations.get(exId) ?? [];
        list.push(
          observation(exId, { source: "operator", provider_status: null, applied: false, observed_at: iso(nowS()) }),
        );
        this.observations.set(exId, list);
        e.version += 1;
        e.updated_at = iso(nowS());
        this.record("execution.reverify_requested", { type: "execution", id }, e.account_id, { note: b.note });
        return ok(e, 202);
      }

      // ------------------------------------------------------------------ payments
      case "listOpsReconciliationRuns": {
        let xs = this.runs;
        if (live !== undefined) xs = xs.filter((r) => r.livemode === live);
        if (q.account) xs = xs.filter((r) => r.account_id === q.account);
        if (q.status) xs = xs.filter((r) => r.status === q.status);
        if (q.day) xs = xs.filter((r) => r.day === q.day);
        if (q.unresolved === "true")
          xs = xs.filter((r) => (r.status === "diff" || r.status === "error") && !r.resolution);
        return ok(page("/v1/ops/reconciliation_runs", xs, q));
      }
      case "getOpsReconciliationRun": {
        const r = this.runs.find((x) => x.id === id);
        return r ? ok(r) : err(404, "invalid_request_error", "resource_missing");
      }
      case "createOpsReconciliationRun": {
        const today = new Date().toISOString().slice(0, 10);
        if (String(b.day) >= today)
          return err(
            422,
            "invalid_request_error",
            "reconciliation_day_open",
            `Day ${b.day} has not ended (UTC); reconcile only completed days.`,
          );
        const earlier = this.runs.find((r) => r.account_id === b.account_id && r.day === b.day);
        const r: RunT = {
          ...run(
            {
              account_id: String(b.account_id) as RunT["account_id"],
              livemode: Boolean(b.livemode),
              day: String(b.day),
            },
            "0",
            "0",
          ),
          status: "running",
          trigger: "ops",
          rerun_of: earlier?.id ?? null,
          started_at: iso(nowS()),
          completed_at: null,
          totals: [],
        };
        this.runs = [r, ...this.runs];
        return ok(r, 202);
      }
      case "resolveOpsReconciliationRun": {
        const r = this.runs.find((x) => x.id === id);
        if (!r) return err(404, "invalid_request_error", "resource_missing");
        if (r.resolution || (r.status !== "diff" && r.status !== "error"))
          return err(409, "state_conflict", "state_conflict");
        r.resolution = {
          classification: b.classification as "other",
          note: String(b.note),
          actor: this.operator.id,
          resolved_at: iso(nowS()),
        };
        this.record("reconciliation.resolved", { type: "reconciliation_run", id }, r.account_id);
        return ok(r);
      }
      case "getOpsRefund": {
        const f = this.refunds.find((x) => x.id === id);
        return f ? ok(f) : err(404, "invalid_request_error", "resource_missing");
      }

      // ------------------------------------------------------------------ audit
      case "listOpsAuditEvents": {
        let xs = this.audit;
        if (q.account) xs = xs.filter((e) => e.account === q.account);
        if (q.actor_type) xs = xs.filter((e) => e.actor.type === q.actor_type);
        if (q.action) xs = xs.filter((e) => e.action === q.action);
        if (q.actor) xs = xs.filter((e) => e.actor.id === q.actor);
        if (q.target) xs = xs.filter((e) => e.target?.id === q.target);
        return ok(page("/v1/ops/audit_events", xs, q));
      }
      default:
        this.unexpected.push(`${route.method} ${route.path} (no handler)`);
        return err(501, "api_error", "api_error", `mock has no handler for ${route.id}`);
    }
  }
}
