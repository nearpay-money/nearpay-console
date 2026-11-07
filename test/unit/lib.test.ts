import {
  approveOpsSuspensionRequest,
  engageOpsKillSwitch,
  opsEnrolmentVerify,
  removeOpsBlocklistEntry,
} from "@nearpay-internal/spec";
import { describe, expect, it, vi } from "vitest";
import { assetDisplay, assetLabel, formatAssetAmount } from "../../src/lib/assets";
import { canReverify, reviewChecks } from "../../src/lib/checks";
import { ApiError } from "../../src/lib/errors";
import * as fmt from "../../src/lib/format";
import { blockedReason, opsAllows } from "../../src/lib/permissions";
import {
  csvField,
  isException,
  matchedPayments,
  reconciliationCsv,
  runLines,
  runResult,
  runTitle,
  toCsv,
  totalsByAsset,
} from "../../src/lib/recon";
import { hrefFor, matchPath, modeFromSearch } from "../../src/lib/router";
import { expiryPhase, restoreSession, safeNext, sessionEndsAt, tokenFromHash } from "../../src/lib/session";
import { execution, run, USDC_BASE } from "../e2e/fixtures";

const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ACCT = "acct_01jbz9k3m4n5p6q7r8s9t0v1w2" as const;

describe("permissions", () => {
  it("derives gating from opsRoles", () => {
    expect(opsAllows(opsEnrolmentVerify, undefined)).toBe(true);
    expect(opsAllows(engageOpsKillSwitch, "ops")).toBe(true);
    expect(opsAllows(approveOpsSuspensionRequest, "ops")).toBe(false);
    expect(opsAllows(approveOpsSuspensionRequest, "ops_admin")).toBe(true);
    expect(opsAllows(engageOpsKillSwitch, undefined)).toBe(false);
    expect(opsAllows({ auth: ["ops:sentinel.read"] }, "ops")).toBe(false);
    expect(blockedReason(removeOpsBlocklistEntry, "ops")).toBe("Only an ops admin can do this.");
    expect(blockedReason(removeOpsBlocklistEntry, "ops_admin")).toBeNull();
    expect(blockedReason(engageOpsKillSwitch, undefined)).toBe("Your console role cannot do this.");
  });
});

describe("router", () => {
  const routes = [
    { name: "home", pattern: "/" },
    { name: "m", pattern: "/merchants/:id" },
  ];
  it("matches patterns", () => {
    expect(matchPath(routes, "/")).toEqual({ name: "home", params: {} });
    expect(matchPath(routes, "/merchants/acct_1/")).toEqual({ name: "m", params: { id: "acct_1" } });
    expect(matchPath(routes, "/merchants/")).toBeNull();
    expect(matchPath(routes, "/merchants/%E0%A4%A")).toBeNull();
    expect(matchPath(routes, "/nope")).toBeNull();
  });
  it("mode lives in ?mode=test only", () => {
    expect(modeFromSearch("?mode=test")).toBe("test");
    expect(modeFromSearch("")).toBe("live");
    expect(hrefFor("/holds", "test")).toBe("/holds?mode=test");
    expect(hrefFor("/holds?mode=test&tab=x", "live")).toBe("/holds?tab=x");
    expect(hrefFor("/holds", "live")).toBe("/holds");
  });
});

describe("session", () => {
  const s = { idle_expires_at: 1000, expires_at: 5000 };
  it("ends at the later idle expiry, capped by the absolute expiry", () => {
    expect(sessionEndsAt(s, undefined)).toEqual({ at: 1000, reason: "idle" });
    expect(sessionEndsAt(s, 2000, 1800)).toEqual({ at: 3800, reason: "idle" });
    expect(sessionEndsAt(s, 4000, 1800)).toEqual({ at: 5000, reason: "absolute" });
  });
  it("phases", () => {
    expect(expiryPhase(1000, 500)).toBe("active");
    expect(expiryPhase(1000, 900)).toBe("warning");
    expect(expiryPhase(1000, 1000)).toBe("expired");
  });
  it("restoreSession: 401 → null, expired → null, other errors rethrown", async () => {
    const session = { expires_at: 2000 };
    expect(await restoreSession({ call: vi.fn(async () => session) } as never, 1000)).toEqual(session);
    expect(await restoreSession({ call: vi.fn(async () => session) } as never, 3000)).toBeNull();
    const e401 = new ApiError({ status: 401, type: "a", code: "authentication_required", message: "" });
    expect(await restoreSession({ call: vi.fn(async () => Promise.reject(e401)) } as never)).toBeNull();
    const e500 = new ApiError({ status: 500, type: "a", code: "api_error", message: "" });
    await expect(restoreSession({ call: vi.fn(async () => Promise.reject(e500)) } as never)).rejects.toBe(e500);
  });
  it("safeNext only allows in-app paths", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil")).toBe("/");
    expect(safeNext("/signin?next=/x")).toBe("/");
    expect(safeNext("/auth/enrol")).toBe("/");
    expect(safeNext("/holds?mode=test")).toBe("/holds?mode=test");
  });
  it("reads enrolment tokens from the fragment", () => {
    expect(tokenFromHash("#token=enrol-token-0123456789abcdef")).toBe("enrol-token-0123456789abcdef");
    expect(tokenFromHash("#token=short")).toBeNull();
    expect(tokenFromHash("")).toBeNull();
  });
});

describe("format", () => {
  it("dates, days and ages", () => {
    expect(fmt.formatDay("2026-11-07")).toBe("7 Nov");
    expect(fmt.formatDay("2026-11-07", true)).toBe("7 Nov 2026");
    expect(fmt.formatDay("bad")).toBe("bad");
    expect(fmt.yesterdayUtc(new Date("2026-11-07T01:00:00Z"))).toBe("2026-11-06");
    const now = Date.UTC(2026, 10, 7, 12, 0, 0);
    const at = (s: number) => new Date(now - s * 1000);
    expect(fmt.formatAge(at(10), now)).toBe("Just now");
    expect(fmt.formatAge(at(12 * 60), now)).toBe("12 min");
    expect(fmt.formatAge(at(3600), now)).toBe("1 hour");
    expect(fmt.formatAge(at(2 * 3600), now)).toBe("2 hours");
    expect(fmt.formatAge(at(3 * 86_400), now)).toBe("3 days");
    expect(fmt.formatUntil(new Date(now - 1), now)).toBe("now");
    expect(fmt.formatUntil(new Date(now + 41 * 60_000), now)).toBe("in 41 min");
    expect(fmt.formatUntil(new Date(now + 23 * 3600_000), now)).toBe("in 23 h");
    expect(fmt.toDate(0).getTime()).toBe(0);
    expect(fmt.isoOf("2026-11-07T00:00:00.000Z")).toBe("2026-11-07T00:00:00.000Z");
    const d = new Date(now);
    expect(fmt.toDate(d)).toBe(d);
    for (const f of [fmt.formatDateTime, fmt.formatTime, fmt.formatTimeSeconds, fmt.formatDate])
      expect(f(1_700_000_000)).toBeTruthy();
  });
  it("references and labels", () => {
    expect(fmt.caseRef("held_execution", "case_01jbz9k3m4n5p6q7r8s9t00118")).toBe("RV–0118");
    expect(fmt.caseRef("new_kind", "case_x0abc")).toBe("CS–0ABC");
    expect(fmt.kybRef("acct_aaaa0082")).toBe("KY–0082");
    expect(fmt.executionRef("ex_1234")).toBe("RV–1234");
    expect(fmt.paymentRef("pi_abcd")).toBe("NP–ABCD");
    expect(fmt.refundRef("re_abcd")).toBe("RF–ABCD");
    expect(fmt.runRef("rcn_abcd")).toBe("RC–ABCD");
    expect(fmt.caseKindLabel("reconciliation_diff")).toBe("Settlement mismatch");
    expect(fmt.caseKindLabel("brand_new_kind")).toBe("Brand new kind");
    expect(fmt.caseKindLabel(null)).toBe("—");
    expect(fmt.kybStatusLabel("approved")).toBe("Reviewed");
    expect(fmt.humanize("")).toBe("");
  });
});

describe("assets", () => {
  it("formats known assets exactly and unknown ones as base units", () => {
    expect(formatAssetAmount("249000000", USDC_BASE)).toBe("249.00 USDC");
    expect(formatAssetAmount(-249000000n, USDC_BASE)).toBe("−249.00 USDC");
    expect(formatAssetAmount("123", "nep141:unknown.near")).toBe("123 base units");
    expect(assetLabel(USDC_NEAR)).toBe("USDC · NEAR");
    expect(assetLabel("nep141:short.near")).toBe("short.near");
    expect(assetLabel(`nep141:${"a".repeat(40)}.near`)).toMatch(/…/);
    expect(assetDisplay(USDC_BASE)?.decimals).toBe(6);
  });
});

describe("reconciliation", () => {
  const ok = run({ account_id: ACCT }, "12460000000", "12460000000");
  const diff = run({ account_id: ACCT }, "8300000000", "8051000000");
  it("lines, totals and counts in bigint", () => {
    expect(runLines(diff)[0]?.difference).toBe(249000000n);
    const t = totalsByAsset([ok, diff, { totals: [] }]);
    expect(t).toHaveLength(1);
    expect(t[0]?.expected).toBe(20760000000n);
    expect(t[0]?.difference).toBe(249000000n);
    const two = totalsByAsset([
      ok,
      {
        totals: [
          {
            ...(ok.totals[0] as (typeof ok.totals)[0]),
            asset_id: USDC_NEAR,
            inflow: { ...(ok.totals[0] as (typeof ok.totals)[0]).inflow, executions: 1 },
          },
        ],
      },
    ]);
    expect(two.map((x) => x.assetId)).toEqual([USDC_BASE, USDC_NEAR]);
    expect(matchedPayments([ok, diff])).toBe(140);
    expect(isException(diff)).toBe(true);
    expect(
      isException({
        ...diff,
        resolution: { classification: "other", note: "n", actor: "a", resolved_at: "2026-11-07T00:00:00.000Z" },
      }),
    ).toBe(false);
    expect(runResult(ok)).toBe("Matched");
    expect(
      runResult({ status: "diff", resolution: { classification: "other", note: "", actor: "", resolved_at: "" } }),
    ).toBe("Resolved");
    expect(runTitle({ day: "2026-11-07" }, "Acme")).toBe("7 Nov · Acme");
    expect(runTitle({ day: "2026-11-07" }, undefined)).toBe("7 Nov · Merchant");
  });
  it("CSV escapes fields and neutralises formulas", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvField("-249000000")).toBe("-249000000");
    expect(csvField(null)).toBe("");
    expect(toCsv([["a", 1]])).toBe("a,1\r\n");
    const empty = {
      ...diff,
      totals: [],
      resolution: {
        classification: "fee_drift" as const,
        note: "fixed",
        actor: "usr",
        resolved_at: "2026-11-07T00:00:00.000Z",
      },
    };
    const csv = reconciliationCsv(
      [
        ok,
        diff,
        empty,
        { ...ok, livemode: false, totals: [{ ...(ok.totals[0] as (typeof ok.totals)[0]), asset_id: "nep141:x.near" }] },
      ],
      (id) => (id === ACCT ? "Acme, Inc" : undefined),
    );
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toMatch(/^run_id,day,account_id,merchant/);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toContain('8300000000,8051000000,249000000,"8,300.00 USDC","8,051.00 USDC",249.00 USDC');
    expect(rows[2]).toContain('"Acme, Inc"');
    expect(rows[3]).toContain("Fee drift,fixed");
    expect(rows[4]).toContain("base units");
  });
});

describe("review checks", () => {
  const acct = ACCT;
  it("never claims success without evidence", () => {
    const held = execution({ account_id: acct });
    const c = reviewChecks(held, true);
    expect(c.map((x) => x.result)).toEqual(["Detected", "Under investigation", "Pending", "Review state delivered"]);
    expect(canReverify(held)).toBe(true);
    expect(canReverify({ state: "succeeded" })).toBe(false);
  });
  it("covers mismatches, attested and verified evidence", () => {
    const base = execution({ account_id: acct, deposit_tx_hashes: [] });
    expect(reviewChecks(base, undefined)[0]?.result).toBe("Not detected");
    expect(reviewChecks(base, undefined)[3]?.result).toBe("No review case found");
    expect(reviewChecks(base, false)[3]?.result).toBe("Not shown to the merchant");
    expect(reviewChecks({ ...base, held_reason: "evidence_mismatch" }, true)[1]?.tone).toBe("danger");
    expect(reviewChecks({ ...base, settled_amount: "1" }, true)[1]?.result).toBe("Different from expected");
    expect(reviewChecks({ ...base, settled_amount: "249000000" }, true)[1]?.result).toBe("Reported, not yet verified");
    const ev = {
      chain: "eip155:8453",
      tx_hash: "0x1234567890",
      block_ref: null,
      recipient: "0x1",
      asset_id: USDC_BASE,
      amount: "249000000",
      finality: "final",
      tier: "A",
      source: "watcher",
      observed_at: "2026-11-07T00:00:00.000Z",
      explorer_url: null,
    } as const;
    const verified = reviewChecks({ ...base, evidence: ev }, true);
    expect(verified[1]?.result).toBe("Matches expected");
    expect(verified[2]?.result).toBe("Confirmed on chain");
    expect(reviewChecks({ ...base, evidence: { ...ev, tier: "B" } }, true)[2]?.result).toBe("Provider-attested");
  });
});
