/**
 * Role gating from the spec route table: each console route lists the operator roles it admits in
 * `opsRoles` (`ops`, `ops_admin`). The UI only hides or disables what the role can never do; it never
 * decides a two-person rule itself — the server answers `403 approver_conflict` (lld §2).
 */
import type { AnyRoute, OpsRole } from "@nearpay-money/spec";

export function opsAllows(route: Pick<AnyRoute, "auth" | "opsRoles">, role: OpsRole | undefined): boolean {
  if (route.auth.includes("anonymous")) return true;
  if (!role || !route.opsRoles) return false;
  return route.opsRoles.includes(role);
}

export const ROLE_LABEL: Readonly<Record<OpsRole, string>> = { ops: "Operations", ops_admin: "Ops admin" };

/** null when allowed, else the sentence to show next to the disabled control. */
export function blockedReason(route: Pick<AnyRoute, "auth" | "opsRoles">, role: OpsRole | undefined): string | null {
  if (opsAllows(route, role)) return null;
  if (route.opsRoles?.length === 1 && route.opsRoles[0] === "ops_admin") return "Only an ops admin can do this.";
  return "Your console role cannot do this.";
}
