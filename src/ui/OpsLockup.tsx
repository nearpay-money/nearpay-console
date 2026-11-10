import { NearPayLogo } from "@nearpay-internal/ui";

/**
 * "NearPay Ops" lock-up (design v2): the Convergence mark and "NearPay" wordmark — brand colours on
 * navy or on light, chosen by the kit's `auto` variant — plus a small "Ops" badge that tells the
 * console apart from the merchant dashboard. Read as one name, "NearPay Ops".
 */
export function OpsLockup({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className={`c-ops-lockup c-ops-lockup--${size}`}>
      {/* label="": the wordmark and the badge are read as plain text */}
      <NearPayLogo size={size} label="" />
      <span className="c-ops-badge">Ops</span>
    </span>
  );
}
