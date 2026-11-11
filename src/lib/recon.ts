/**
 * Reconciliation run summaries (payments §9, RB-05). Expected = Σ statement lines, observed = Σ
 * verified evidence, per settlement asset (inflow); difference = expected − observed. Bigint only
 * (INV-5): amounts of different assets are never added together.
 */

import type { ReconciliationRun as RunSchema } from "@nearpay-internal/spec";
import type { z } from "@nearpay-money/spec";
import { assetDisplay, assetLabel, formatAssetAmount } from "./assets";
import { formatDay, reconClassificationLabel, reconStatusLabel } from "./format";

export type ReconciliationRun = z.output<typeof RunSchema>;

export interface AssetLine {
  readonly assetId: string;
  readonly expected: bigint;
  readonly observed: bigint;
  readonly difference: bigint;
  readonly executions: number;
}

/** Per-asset inflow lines of a run, in the run's asset order. */
export function runLines(run: Pick<ReconciliationRun, "totals">): AssetLine[] {
  return run.totals.map((t) => {
    const expected = BigInt(t.inflow.statement);
    const observed = BigInt(t.inflow.evidence);
    return {
      assetId: t.asset_id,
      expected,
      observed,
      difference: expected - observed,
      executions: t.inflow.executions,
    };
  });
}

/** Totals per asset across runs (the page's headline numbers). */
export function totalsByAsset(runs: readonly Pick<ReconciliationRun, "totals">[]): AssetLine[] {
  const m = new Map<string, { expected: bigint; observed: bigint; executions: number }>();
  for (const r of runs)
    for (const l of runLines(r)) {
      const cur = m.get(l.assetId) ?? { expected: 0n, observed: 0n, executions: 0 };
      cur.expected += l.expected;
      cur.observed += l.observed;
      cur.executions += l.executions;
      m.set(l.assetId, cur);
    }
  return [...m.entries()]
    .map(([assetId, v]) => ({ assetId, ...v, difference: v.expected - v.observed }))
    .sort((a, b) => b.executions - a.executions);
}

/** Payments counted in runs that matched (`ok`). */
export function matchedPayments(runs: readonly Pick<ReconciliationRun, "status" | "totals">[]): number {
  return runs
    .filter((r) => r.status === "ok")
    .reduce((n, r) => n + r.totals.reduce((m, t) => m + t.inflow.executions, 0), 0);
}

/** Runs with diffs or errors that nobody has explained yet. */
export function isException(r: Pick<ReconciliationRun, "status" | "resolution">): boolean {
  return (r.status === "diff" || r.status === "error") && r.resolution === null;
}

/** Badge text for a run: resolved runs say so; otherwise the status. */
export function runResult(r: Pick<ReconciliationRun, "status" | "resolution">): string {
  if (r.resolution) return "Resolved";
  return reconStatusLabel(r.status);
}

/** Neutralises spreadsheet formula injection and quotes a CSV field (RFC 4180). */
export function csvField(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `${rows.map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`;
}

/** The reconciliation report: one row per run and asset. Merchant names come from the caller. */
export function reconciliationCsv(
  runs: readonly ReconciliationRun[],
  merchantName: (accountId: string) => string | undefined,
): string {
  const header = [
    "run_id",
    "day",
    "account_id",
    "merchant",
    "livemode",
    "status",
    "asset",
    "decimals",
    "expected_base_units",
    "observed_base_units",
    "difference_base_units",
    "expected",
    "observed",
    "difference",
    "payments",
    "diffs",
    "resolution",
    "resolution_note",
  ];
  const rows: (string | number | null)[][] = [header];
  for (const r of runs) {
    const lines = runLines(r);
    const base = [r.id, r.day, r.account_id, merchantName(r.account_id) ?? "", r.livemode ? "true" : "false"];
    const tail = [
      r.diff_count,
      r.resolution ? reconClassificationLabel(r.resolution.classification) : "",
      r.resolution?.note ?? "",
    ];
    if (lines.length === 0) rows.push([...base, runResult(r), "", "", "", "", "", "", "", "", 0, ...tail]);
    for (const l of lines) {
      const a = assetDisplay(l.assetId);
      rows.push([
        ...base,
        runResult(r),
        l.assetId,
        a ? a.decimals : "",
        l.expected.toString(),
        l.observed.toString(),
        l.difference.toString(),
        formatAssetAmount(l.expected, l.assetId),
        formatAssetAmount(l.observed, l.assetId),
        formatAssetAmount(l.difference, l.assetId),
        l.executions,
        ...tail,
      ]);
    }
  }
  return toCsv(rows);
}

/** "7 Nov · Acme Studio". */
export function runTitle(r: Pick<ReconciliationRun, "day">, merchant: string | undefined): string {
  return `${formatDay(r.day)} · ${merchant ?? "Merchant"}`;
}

export { assetLabel };
