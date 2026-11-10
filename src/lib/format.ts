/** Display helpers: dates (operator's local time zone), ages, references and enum labels. */

type DateInput = number | string | Date;

/** Unix seconds (number), RFC 3339 string or Date → Date. */
export function toDate(v: DateInput): Date {
  if (v instanceof Date) return v;
  return typeof v === "number" ? new Date(v * 1000) : new Date(v);
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const TIME_S = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "7 Nov 2026, 10:30 IST". */
export const formatDateTime = (v: DateInput) => DATE_TIME.format(toDate(v));
/** "10:30 IST". */
export const formatTime = (v: DateInput) => TIME.format(toDate(v));
/** "10:30:12". */
export const formatTimeSeconds = (v: DateInput) => TIME_S.format(toDate(v));
/** "7 Nov 2026". */
export const formatDate = (v: DateInput) => DATE.format(toDate(v));
/** ISO string for `<time dateTime>`. */
export const isoOf = (v: DateInput) => toDate(v).toISOString();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** UTC day `2026-11-07` → "7 Nov" (no time-zone shift: reconciliation days are UTC days). */
export function formatDay(day: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const d = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
  return withYear ? `${d} ${m[1]}` : d;
}

/** Previous completed UTC day (`YYYY-MM-DD`). */
export function yesterdayUtc(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return d.toISOString().slice(0, 10);
}

/** "12 min", "2 hours", "3 days" since `v`. */
export function formatAge(v: DateInput, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - toDate(v).getTime()) / 1000));
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return h === 1 ? "1 hour" : `${h} hours`;
  const d = Math.floor(h / 24);
  return `${d} days`;
}

/** "in 23 h", "in 41 min" until `v`. */
export function formatUntil(v: DateInput, now: number = Date.now()): string {
  const s = Math.floor((toDate(v).getTime() - now) / 1000);
  if (s <= 0) return "now";
  const m = Math.ceil(s / 60);
  if (m < 60) return `in ${m} min`;
  return `in ${Math.round(m / 60)} h`;
}

/** Short human reference for a long id: `RV–0118`-style (prefix + last four characters). */
export function shortRef(prefix: string, id: string): string {
  return `${prefix}–${id.slice(-4).toUpperCase()}`;
}

/** `snake_case` → "Snake case" (fallback label for open-enum values this build does not know). */
export function humanize(v: string): string {
  const s = v.replace(/[_.]+/g, " ").trim();
  return s ? s[0]?.toUpperCase() + s.slice(1) : v;
}

const label =
  (m: Readonly<Record<string, string>>) =>
  (v: string | null | undefined): string =>
    v == null ? "—" : (m[v] ?? humanize(v));

export const caseKindLabel = label({
  screening_hit: "Screening hit",
  post_screen_hit: "Post-settlement screening hit",
  held_execution: "Payment needs review",
  audit_mismatch: "Settlement audit mismatch",
  merchant_report: "Merchant report",
  reconciliation_diff: "Settlement mismatch",
});

const CASE_PREFIX: Readonly<Record<string, string>> = {
  screening_hit: "SC",
  post_screen_hit: "SC",
  held_execution: "RV",
  audit_mismatch: "AU",
  merchant_report: "MR",
  reconciliation_diff: "RC",
};
export const caseRef = (kind: string, id: string) => shortRef(CASE_PREFIX[kind] ?? "CS", id);
export const kybRef = (accountId: string) => shortRef("KY", accountId);
export const executionRef = (id: string) => shortRef("RV", id);
export const paymentRef = (id: string) => shortRef("NP", id);
export const refundRef = (id: string) => shortRef("RF", id);
export const runRef = (id: string) => shortRef("RC", id);

export const severityLabel = label({ low: "Low", medium: "Normal", high: "High", critical: "Critical" });
export const SEVERITY_RANK: Readonly<Record<string, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

export const caseStatusLabel = label({ open: "Open", investigating: "Investigating", closed: "Closed" });
export const caseResolutionLabel = label({
  no_action: "No action needed",
  false_positive: "False positive",
  merchant_contacted: "Merchant contacted",
  destination_blocked: "Destination blocked",
  account_suspended: "Account suspended",
  other: "Other",
});
export const caseActionLabel = label({
  opened: "Case opened",
  assigned: "Assigned",
  unassigned: "Unassigned",
  commented: "Note added",
  closed: "Case closed",
});

export const kybStatusLabel = label({
  not_started: "Not submitted",
  pending: "Submitted",
  needs_info: "Action needed",
  approved: "Active",
  rejected: "Rejected",
});
export const businessTypeLabel = label({
  sole_proprietorship: "Sole proprietorship",
  partnership: "Partnership",
  company: "Company",
  non_profit: "Non-profit",
  other: "Other",
});
export const volumeBandLabel = label({
  under_10k: "Under $10k / month",
  "10k_to_100k": "$10k–$100k / month",
  "100k_to_1m": "$100k–$1M / month",
  over_1m: "Over $1M / month",
});

export const merchantStatusLabel = label({ active: "Active", suspended: "Suspended", closed: "Closed" });

export const executionStateLabel = label({
  quoting: "Quoting",
  awaiting_deposit: "Awaiting deposit",
  deposit_detected: "Payment detected",
  incomplete_deposit: "Incomplete deposit",
  settling: "Settling",
  verifying: "Confirming",
  succeeded: "Succeeded",
  refunded: "Refunded",
  failed: "Failed",
  expired_unpaid: "Expired",
  held: "Review",
});
export const heldReasonLabel = label({
  evidence_mismatch: "Evidence does not match",
  evidence_timeout: "Evidence overdue",
  failed_after_deposit: "Failed after deposit",
  unknown_status: "Unknown provider status",
});
export const observationSourceLabel = label({
  quote: "Quote",
  submit: "Deposit submitted",
  hot_poll: "Provider status poll",
  explorer: "Provider explorer",
  indexer: "Chain indexer",
  watcher: "Chain watcher",
  verifier: "Verifier",
  operator: "Operator re-check",
});

export const reconStatusLabel = label({ running: "Running", ok: "Matched", diff: "Review", error: "Failed" });
export const reconClassificationLabel = label({
  missed_event: "Missed event",
  fee_drift: "Fee drift",
  provider_data: "Provider data issue",
  real_loss: "Real loss",
  other: "Other",
});
export const reconDiffLabel = label({
  missing_statement_line: "Missing statement line",
  missing_evidence: "Missing evidence",
  amount_mismatch: "Amount mismatch",
  asset_mismatch: "Asset mismatch",
  fee_mismatch: "Fee mismatch",
  duplicate_line: "Duplicate line",
});

export const findingResultLabel = label({ pass: "Matched", mismatch: "Mismatch", unverifiable: "Unverifiable" });
export const approvalStatusLabel = label({
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
});
export const approvalActionLabel = label({
  "account.suspend": "Suspend account",
  "account.reinstate": "Reinstate account",
  "kill_switch.release": "Release kill switch",
});
export const refundStatusLabel = label({
  requires_action: "Awaiting signature",
  pending: "Pending",
  succeeded: "Returned",
  failed: "Failed",
  canceled: "Canceled",
});
export const actorTypeLabel = label({
  user: "Merchant user",
  api_key: "API key",
  operator: "Operator",
  service: "Service",
  system: "System",
});
