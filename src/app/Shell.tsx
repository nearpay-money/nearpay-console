/**
 * "NearPay Operations · Internal workspace" shell (Figma b02/b03): sidebar with the operations nav,
 * top bar with breadcrumb, mode pill and notifications, plus a global kill-switch banner.
 */
import { getOpsKillSwitch, listOpsFindings } from "@nearpay-internal/spec";
import { AppShell, Breadcrumb, Button, Callout, type NavGroup } from "@nearpay-internal/ui";
import { type ReactNode, useEffect, useState } from "react";
import { formatDateTime } from "../lib/format";
import { ROLE_LABEL } from "../lib/permissions";
import { passkeyBadge } from "../lib/session";
import { Link, useApp } from "./context";

export type Section =
  | "overview"
  | "merchants"
  | "kyb"
  | "cases"
  | "holds"
  | "reconciliation"
  | "audit"
  | "sentinel"
  | "blocklist";

const OPERATIONS: readonly [Section, string, string][] = [
  ["overview", "Overview", "/"],
  ["merchants", "Merchants", "/merchants"],
  ["kyb", "Business reviews", "/kyb"],
  ["cases", "Cases", "/cases"],
  ["holds", "Payment holds", "/holds"],
  ["reconciliation", "Reconciliation", "/reconciliation"],
  ["audit", "Audit log", "/audit"],
];
const RISK: readonly [Section, string, string][] = [
  ["sentinel", "Sentinel", "/sentinel"],
  ["blocklist", "Blocklist", "/blocklist"],
];

export const SECTION_LABEL: Readonly<Record<Section, string>> = Object.fromEntries(
  [...OPERATIONS, ...RISK].map(([id, label]) => [id, label]),
) as Record<Section, string>;

/** "riya.k@nearpay.money" → "Riya". */
export function operatorName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const first = local.split(/[._+-]/)[0] || local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

interface Signals {
  engaged: boolean;
  engagedAt?: string;
  reason?: string;
  openFindings: number;
}

/** Kill-switch state and open findings, refreshed every minute while signed in. */
function useSignals(): Signals | undefined {
  const { api, session, location } = useApp();
  const [s, setS] = useState<Signals>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on navigation too
  useEffect(() => {
    if (!session) return;
    let live = true;
    const load = () => {
      Promise.allSettled([
        api.call(getOpsKillSwitch),
        api.call(listOpsFindings, { query: { acknowledged: "false", limit: 100 } }),
      ]).then(([ks, f]) => {
        if (!live) return;
        setS({
          engaged: ks.status === "fulfilled" ? ks.value.engaged : false,
          engagedAt: ks.status === "fulfilled" ? ks.value.updated_at : undefined,
          reason: ks.status === "fulfilled" ? ks.value.reason : undefined,
          openFindings: f.status === "fulfilled" ? f.value.data.filter((x) => x.result !== "pass").length : 0,
        });
      });
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api, session, location.pathname]);
  return s;
}

export function Shell({
  section,
  crumbs = [],
  children,
}: {
  section: Section;
  /** Breadcrumb after "Operations / <section>". */
  crumbs?: readonly string[];
  children: ReactNode;
}) {
  const app = useApp();
  const signals = useSignals();
  const group = (label: string, items: readonly [Section, string, string][]): NavGroup => ({
    label,
    items: items.map(([id, l, path]) => ({ id, label: l, href: app.href(path), current: id === section })),
  });
  const items = [
    { label: "Operations", href: app.href("/") },
    ...(section === "overview" ? [{ label: "Overview" }] : [{ label: SECTION_LABEL[section], href: undefined }]),
  ];
  if (crumbs.length) {
    const sectionPath = [...OPERATIONS, ...RISK].find(([id]) => id === section)?.[2] ?? "/";
    (items[1] as { href?: string }).href = app.href(sectionPath);
    for (const c of crumbs) items.push({ label: c });
  }
  const session = app.session;
  return (
    <AppShell
      workspace={{ name: "NearPay Operations", subtitle: "Internal workspace" }}
      navLabel="Operations"
      nav={[group("Operations", OPERATIONS), group("Risk controls", RISK)]}
      footerLinks={[{ label: "Help & support", href: "https://docs.nearpay.money/operations" }]}
      user={
        session
          ? {
              name: operatorName(session.operator.email),
              // beta: an operator who registered a platform passkey (NP_OPS_ALLOW_PLATFORM_PASSKEYS)
              role: [ROLE_LABEL[session.role], passkeyBadge(session)].filter(Boolean).join(" · "),
            }
          : undefined
      }
      breadcrumb={<Breadcrumb items={items} />}
      mode={app.mode}
      notifications={{
        unread: signals?.openFindings ?? 0,
        onClick: () => app.navigate(app.href("/sentinel?tab=findings")),
      }}
      topbarActions={
        <Button variant="ghost" size="sm" onClick={() => void app.signOut()}>
          Sign out
        </Button>
      }
    >
      {signals?.engaged ? (
        <div className="c-banner">
          <Callout
            tone="danger"
            title="Kill switch engaged — live quoting is stopped"
            reference={signals.engagedAt ? `Since ${formatDateTime(signals.engagedAt)}` : undefined}
          >
            <p>
              {signals.reason ? `${signals.reason} · ` : ""}
              <Link to="/sentinel">Open Sentinel</Link>
            </p>
          </Callout>
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
