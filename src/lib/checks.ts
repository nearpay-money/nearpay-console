/**
 * The "Resolve with evidence" checks of a held execution (Figma: Review RV-xxxx). Each check is
 * derived only from the execution's own evidence fields — the console never decides that a payment
 * succeeded (INV-2): only the Verifier moves an execution to `succeeded`, and there is no
 * "mark paid" override.
 */

import type { Execution as ExecutionSchema } from "@nearpay-internal/spec";
import type { z } from "@nearpay-money/spec";

export type Execution = z.output<typeof ExecutionSchema>;

export type CheckTone = "success" | "progress" | "warning" | "danger" | "neutral";

export interface ReviewCheck {
  readonly id: string;
  readonly label: string;
  readonly result: string;
  readonly tone: CheckTone;
  /** Shown as a badge (attention) rather than plain text. */
  readonly badge: boolean;
}

export function reviewChecks(ex: Execution, merchantReviewOpen: boolean | undefined): ReviewCheck[] {
  const detected = ex.deposit_tx_hashes.length > 0 || ex.evidence !== null || ex.settled_amount !== null;
  const expected = BigInt(ex.settlement.expected);
  const settled = ex.settled_amount !== null ? BigInt(ex.settled_amount) : null;
  const evAmount = ex.evidence ? BigInt(ex.evidence.amount) : null;

  let amount: Pick<ReviewCheck, "result" | "tone" | "badge">;
  if (ex.held_reason === "evidence_mismatch")
    amount = { result: "Mismatch — under investigation", tone: "danger", badge: true };
  else if (evAmount !== null && evAmount === expected)
    amount = { result: "Matches expected", tone: "success", badge: false };
  else if (settled !== null && settled !== expected)
    amount = { result: "Different from expected", tone: "danger", badge: true };
  else if (settled !== null) amount = { result: "Reported, not yet verified", tone: "warning", badge: false };
  else amount = { result: "Under investigation", tone: "neutral", badge: false };

  let confirmation: Pick<ReviewCheck, "result" | "tone" | "badge">;
  if (ex.evidence?.tier === "A") confirmation = { result: "Confirmed on chain", tone: "success", badge: true };
  else if (ex.evidence) confirmation = { result: "Provider-attested", tone: "warning", badge: true };
  else confirmation = { result: "Pending", tone: "progress", badge: true };

  const notification: Pick<ReviewCheck, "result" | "tone" | "badge"> =
    merchantReviewOpen === undefined
      ? { result: "No review case found", tone: "neutral", badge: false }
      : merchantReviewOpen
        ? { result: "Review state delivered", tone: "neutral", badge: false }
        : { result: "Not shown to the merchant", tone: "neutral", badge: false };

  return [
    {
      id: "payer",
      label: "Payer transfer",
      result: detected ? "Detected" : "Not detected",
      tone: detected ? "neutral" : "warning",
      badge: false,
    },
    { id: "amount", label: "Destination amount", ...amount },
    { id: "confirmation", label: "Independent confirmation", ...confirmation },
    { id: "notification", label: "Merchant notification", ...notification },
  ];
}

/** Executions the Verifier can be asked to re-check (rails: `held` or `verifying`). */
export const canReverify = (ex: Pick<Execution, "state">) => ex.state === "held" || ex.state === "verifying";

/**
 * Post-success finality re-check (rails §8.12, ADR-0022): payments confirmed on one block are read
 * again at the chain's finality. The result reaches the console only as a `verifier` observation
 * (`applied: false`) whose payload carries `finality_recheck: {outcome, reason, …}` — it is not on the
 * spec `Execution`, and a failure never moves the execution out of `succeeded`; ops decide.
 */
export interface FinalityRecheck {
  readonly outcome: "finalized" | "failed" | "timeout" | "other";
  readonly label: string;
  readonly tone: CheckTone;
  readonly reason: string | null;
}

export function finalityRecheckOf(o: { readonly source: string; readonly payload?: unknown }): FinalityRecheck | null {
  const p = o.payload;
  if (!p || typeof p !== "object" || !("finality_recheck" in p)) return null;
  const r = (p as { finality_recheck?: unknown }).finality_recheck;
  if (!r || typeof r !== "object") return null;
  const raw = (r as { outcome?: unknown }).outcome;
  const reasonRaw = (r as { reason?: unknown }).reason;
  const reason = typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim() : null;
  if (raw === "finalized") return { outcome: "finalized", label: "Finality re-check passed", tone: "success", reason };
  if (raw === "failed") return { outcome: "failed", label: "Finality re-check failed", tone: "danger", reason };
  if (raw === "timeout") return { outcome: "timeout", label: "Finality re-check timed out", tone: "warning", reason };
  return { outcome: "other", label: "Finality re-check", tone: "neutral", reason };
}
