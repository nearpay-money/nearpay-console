/**
 * Adaptive two-person rule (compliance §5.1, sentinel §6): on a single-operator platform the server adds
 * `single_operator` to an `OpsApproval` (an extension, not yet in the spec) — when its requester may complete
 * it alone and the minimum reason length. Absent: a second, different operator must approve.
 */
import type { z } from "@nearpay/spec";
import type { OpsApproval as OpsApprovalSchema } from "@nearpay-internal/spec";

type OpsApproval = z.output<typeof OpsApprovalSchema>;

/** The server's single-operator extension of a request (absent: two persons needed). */
export interface SingleOperatorInfo {
  used: boolean;
  available_at: number | null;
  reason_min_length: number;
}

export function singleOperatorOf(a: OpsApproval | object): SingleOperatorInfo | null {
  const x = (a as { single_operator?: Partial<SingleOperatorInfo> }).single_operator;
  if (!x || typeof x !== "object") return null;
  return {
    used: x.used === true,
    available_at: typeof x.available_at === "number" ? x.available_at : null,
    reason_min_length: typeof x.reason_min_length === "number" ? x.reason_min_length : 20,
  };
}

/** The requester may complete the request alone now (single-operator platform, wait over). */
export function canCompleteAlone(info: SingleOperatorInfo | null, nowSec: number): boolean {
  return info !== null && !info.used && (info.available_at === null || info.available_at <= nowSec);
}
