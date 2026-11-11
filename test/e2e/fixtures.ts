/**
 * Spec-valid fixtures for the console mock API. Every builder's output is checked against its
 * `@nearpay-internal/spec` schema by the mock (responses are validated) and by test/unit/fixtures.test.ts.
 */

import type {
  BlocklistEntry,
  ComplianceCase,
  Execution,
  MerchantSuspension,
  OpsAuditFinding,
  OpsKillSwitch,
  OpsKybCase,
  OpsMerchant,
  ProviderObservation,
  ReconciliationRun,
} from "@nearpay-internal/spec";
import type { AuditEvent, Refund, z } from "@nearpay-money/spec";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
let seq = 0;
/** A valid TypeID-style id `<prefix>_01jbz9k3m4n5p6q7r8s9t0` + 4 base32 chars. */
export function newId<P extends string>(prefix: P): `${P}_${string}` {
  let n = ++seq;
  let tail = "";
  for (let i = 0; i < 4; i++) {
    tail = ALPHA[n % 32] + tail;
    n = Math.floor(n / 32);
  }
  return `${prefix}_01jbz9k3m4n5p6q7r8s9t0${tail}` as `${P}_${string}`;
}

export const NOW = Math.floor(Date.now() / 1000);
export const iso = (sec: number) => new Date(sec * 1000).toISOString();
export const YESTERDAY = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1),
)
  .toISOString()
  .slice(0, 10);

export const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export const OP_ME = { id: newId("usr"), email: "riya@nearpay.money" } as const;
export const OP_OTHER = { id: newId("usr"), email: "sam@nearpay.money" } as const;

export type MerchantT = z.output<typeof OpsMerchant>;
export type SuspensionT = z.output<typeof MerchantSuspension>;
export type KybCaseT = z.output<typeof OpsKybCase>;
export type CaseT = z.output<typeof ComplianceCase>;
export type BlocklistT = z.output<typeof BlocklistEntry>;
export type KillSwitchT = z.output<typeof OpsKillSwitch>;
export type FindingT = z.output<typeof OpsAuditFinding>;
export type ExecutionT = z.output<typeof Execution>;
export type ObservationT = z.output<typeof ProviderObservation>;
export type RunT = z.output<typeof ReconciliationRun>;
export type RefundT = z.output<typeof Refund>;
export type AuditEventT = z.output<typeof AuditEvent>;

export function merchant(o: Partial<MerchantT> & { display_name: string }): MerchantT {
  return {
    id: newId("acct"),
    object: "account",
    created: NOW - 40 * 86_400,
    verified_legal_name: null,
    country: "GB",
    status: "active",
    kyb_status: "approved",
    live_enabled: true,
    fee_bearer: "payer",
    api_version: "2026-11-01",
    settings: {
      late_payments: false,
      underpay_tolerance_bps: 0,
      session_ttl_default: 3600,
      email_receipts: true,
      branding: { accent_color: null, logo_url: null },
    },
    owners: [{ id: newId("usr"), email: "owner@example.com" }],
    member_count: 3,
    active_live_destinations: 1,
    recovered_at: null,
    ...o,
  };
}

export function suspension(accountId: MerchantT["id"], o: Partial<SuspensionT> = {}): SuspensionT {
  return {
    object: "merchant_suspension",
    account_id: accountId,
    suspended: false,
    reason: null,
    actor: null,
    updated_at: null,
    pending_request: null,
    ...o,
  };
}

export function kybCase(m: MerchantT, o: Partial<KybCaseT> = {}): KybCaseT {
  return {
    object: "ops_kyb_case",
    account_id: m.id,
    account_display_name: m.display_name,
    status: "pending",
    profile: {
      legal_name: `${m.display_name} Ltd`,
      country_of_incorporation: "GB",
      registration_number: "12345678",
      business_type: "company",
      website: "https://example.com",
      business_address: {
        line1: "1 High Street",
        line2: null,
        city: "London",
        postal_code: "EC1A 1AA",
        region: null,
        country: "GB",
      },
      representative: { name: "Jordan Lee", title: "Director" },
      expected_monthly_volume: "10k_to_100k",
    },
    declared_by: m.owners[0]?.id ?? null,
    requested_info: null,
    decision_reason: null,
    decided_by: null,
    created: NOW - 3 * 86_400,
    submitted_at: NOW - 2 * 3600,
    decided_at: null,
    history: [{ status: "pending", actor: m.owners[0]?.id ?? "system", reason: null, at: NOW - 2 * 3600 }],
    ...o,
  };
}

export function complianceCase(o: Partial<CaseT> & Pick<CaseT, "kind" | "subject">): CaseT {
  return {
    id: newId("case"),
    object: "compliance_case",
    account_id: null,
    livemode: true,
    severity: "high",
    status: "open",
    assignee: null,
    resolution: null,
    review: false,
    created: NOW - 12 * 60,
    closed_at: null,
    events: [{ actor: "system", action: "opened", note: "Opened automatically.", at: NOW - 12 * 60 }],
    ...o,
  };
}

export function blocklistEntry(o: Partial<BlocklistT> = {}): BlocklistT {
  return {
    id: newId("bl"),
    object: "blocklist_entry",
    subject_type: "address",
    chain: "eip155:8453",
    subject: "0x000000000000000000000000000000000000dead",
    reason: "Linked to a reported scam",
    created_by: OP_OTHER.id,
    created: NOW - 5 * 86_400,
    ...o,
  };
}

export function killSwitch(o: Partial<KillSwitchT> = {}): KillSwitchT {
  return {
    engaged: false,
    reason: "Released after incident review",
    actor: `${OP_OTHER.id}+${OP_ME.id}`,
    updated_at: iso(NOW - 3 * 86_400),
    version: 4,
    pending_release: null,
    ...o,
  };
}

export function finding(o: Partial<FindingT> & Pick<FindingT, "execution_id" | "account_id">): FindingT {
  return {
    id: newId("fnd"),
    object: "audit_finding",
    livemode: true,
    check_kind: "settlement_recipient_amount",
    result: "mismatch",
    details: { expected_amount: "249000000", observed_amount: "0" },
    created: NOW - 40 * 60,
    tx_chain: "eip155:8453",
    tx_hash: "0xabc123def4567890abc123def4567890abc123def4567890abc123def4567890",
    acknowledged_at: null,
    acknowledged_by: null,
    acknowledgement_note: null,
    ...o,
  };
}

export function execution(o: Partial<ExecutionT> & Pick<ExecutionT, "account_id">): ExecutionT {
  return {
    id: newId("ex"),
    version: 3,
    livemode: true,
    kind: "payment",
    method: "route_quote",
    provider: "oneclick",
    state: "held",
    provider_status: "PROCESSING",
    route_class: "same_asset",
    applied_fee_bps: 100,
    origin: {
      asset_id: USDC_BASE,
      chain: "eip155:8453",
      refund_to: "0x71c7656ec7ab88b098defb751b7401b5f6d89a42",
      refund_type: "origin_chain",
    },
    settlement: {
      asset_id: USDC_BASE,
      amount_base: "249000000",
      tag: "0",
      expected: "249000000",
      recipient: "0x8f3cf7ad23cd3cadbd9735aff958023239c6d920",
      recipient_type: "destination_chain",
      chain: "eip155:8453",
    },
    price_snapshot: null,
    deposit: {
      address: "0x2f1a4b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a",
      memo: null,
      amount_in: "251490000",
      min_amount_in: "251490000",
      chain: "eip155:8453",
      deadline: iso(NOW + 600),
    },
    intents_requirement: null,
    deposit_tx_hashes: ["0x9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c"],
    settled_amount: null,
    refunded_amount: null,
    refund_reason: null,
    evidence: null,
    failure_code: null,
    held_reason: "evidence_timeout",
    deadline: iso(NOW + 600),
    terminal_at: null,
    created_at: iso(NOW - 20 * 60),
    updated_at: iso(NOW - 12 * 60),
    reference: { payment_intent: newId("pi"), payment_attempt: newId("pa"), refund: null, refund_leg: null },
    refund: null,
    ...o,
  };
}

export function observation(exId: ExecutionT["id"], o: Partial<ObservationT> = {}): ObservationT {
  return {
    id: newId("obs"),
    execution_id: exId,
    source: "hot_poll",
    provider_status: "PROCESSING",
    provider_updated_at: iso(NOW - 15 * 60),
    applied: true,
    observed_at: iso(NOW - 15 * 60),
    payload_sha256: "a".repeat(64),
    payload: { status: "PROCESSING" },
    archive: null,
    ...o,
  };
}

export function run(o: Partial<RunT> & Pick<RunT, "account_id">, expected: string, observed: string): RunT {
  const ok = expected === observed;
  return {
    id: newId("rcn"),
    object: "reconciliation_run",
    livemode: true,
    day: YESTERDAY,
    status: ok ? "ok" : "diff",
    trigger: "schedule",
    rerun_of: null,
    started_at: iso(NOW - 8 * 3600),
    completed_at: iso(NOW - 8 * 3600 + 30),
    totals: [
      {
        asset_id: USDC_BASE,
        inflow: { statement: expected, evidence: observed, statement_lines: 12, executions: ok ? 140 : 11 },
        outflow: { statement: "0", evidence: "0", statement_lines: 0, executions: 0 },
        fees: { expected: "1240000", observed: "1240000" },
      },
    ],
    diffs: ok
      ? []
      : [
          {
            kind: "missing_evidence",
            asset_id: USDC_BASE,
            execution_id: null,
            balance_transaction: newId("txn"),
            payment_intent: newId("pi"),
            refund: null,
            statement_amount: (BigInt(expected) - BigInt(observed)).toString(),
            evidence_amount: null,
            detail: "Statement line without verified settlement evidence.",
          },
        ],
    diff_count: ok ? 0 : 1,
    error: null,
    resolution: null,
    ...o,
  };
}

export function refund(o: Partial<RefundT> = {}): RefundT {
  return {
    id: newId("re"),
    object: "refund",
    created: NOW - 3600,
    livemode: true,
    status: "pending",
    payment_intent: newId("pi"),
    payment_attempt: newId("pa"),
    amount: "49000000",
    asset_id: USDC_BASE,
    decimals: 6,
    fee_mode: "payer_absorbs",
    reason: "requested_by_customer",
    method: "route_quote",
    recipient: {
      address: "0x71c7656ec7ab88b098defb751b7401b5f6d89a42",
      asset_id: USDC_BASE,
      chain: "eip155:8453",
      type: "origin_chain",
      overridden: false,
    },
    next_action: null,
    legs: [],
    amount_received: null,
    evidence: null,
    extra_amount_sent: "0",
    source: "dashboard",
    failure_code: null,
    succeeded_at: null,
    canceled_at: null,
    sequence: 2,
    metadata: {},
    ...o,
  };
}

export function auditEvent(o: Partial<AuditEventT> & Pick<AuditEventT, "action">): AuditEventT {
  return {
    id: newId("aud"),
    object: "audit_event",
    created: NOW - 600,
    account: null,
    actor: { type: "operator", id: OP_OTHER.id },
    target: null,
    details: {},
    ...o,
  };
}
