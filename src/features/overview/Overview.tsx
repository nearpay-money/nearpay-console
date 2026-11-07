/**
 * Operations overview (Figma b02/b03 "Operations overview"): payment reviews (Verifier holds),
 * business reviews awaiting a decision, reconciliation exceptions, and one queue of open cases.
 */
import { listOpsCases, listOpsExecutions, listOpsKybCases, listOpsReconciliationRuns } from "@nearpay-internal/spec";
import { Callout, Skeleton, Stat, StatGroup, StatusBadge, Table, type TableColumn } from "@nearpay-internal/ui";
import { useEffect } from "react";
import { Link, useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { caseKindLabel, caseRef, formatAge, formatTime, kybRef, SEVERITY_RANK, severityLabel } from "../../lib/format";
import { useAsync, useNow } from "../../lib/hooks";
import { ErrorState, Header, Page, Section } from "../../ui/ui";

interface QueueRow {
  key: string;
  ref: string;
  href: string;
  accountId: string | null;
  merchant: string | undefined;
  reason: string;
  created: number;
  severity: string;
}

const PRIORITY_TONE = { critical: "danger", high: "warning", medium: "neutral", low: "neutral" } as const;

export function Overview() {
  const app = useApp();
  const live = app.mode === "live" ? "true" : "false";
  const now = useNow();

  const holds = useAsync(
    () => app.api.call(listOpsExecutions, { query: { livemode: live, state: "held", limit: 100 } }),
    [live],
  );
  const kyb = useAsync(() => app.api.call(listOpsKybCases, { query: { status: "pending", limit: 100 } }), []);
  const exceptions = useAsync(
    () => app.api.call(listOpsReconciliationRuns, { query: { livemode: live, unresolved: "true", limit: 100 } }),
    [live],
  );
  const lastRun = useAsync(
    () => app.api.call(listOpsReconciliationRuns, { query: { livemode: live, limit: 1 } }),
    [live],
  );
  const cases = useAsync(() => app.api.call(listOpsCases, { query: { livemode: live, limit: 50 } }), [live]);

  useEffect(() => {
    for (const k of kyb.data?.data ?? []) app.rememberMerchant(k.account_id, k.account_display_name);
  }, [kyb.data, app.rememberMerchant]);

  const count = (d: { data: readonly unknown[]; has_more: boolean } | undefined) =>
    d ? `${d.data.length}${d.has_more ? "+" : ""}` : undefined;

  const heldCount = count(holds.data);
  const oldestHeld = holds.data?.data.reduce<string | undefined>(
    (min, e) => (!min || e.created_at < min ? e.created_at : min),
    undefined,
  );
  const exceptionCount = exceptions.data?.data.length;
  const latest = lastRun.data?.data[0];

  const rows: QueueRow[] = [
    ...(cases.data?.data ?? []).map((c) => ({
      key: c.id,
      ref: caseRef(c.kind, c.id),
      href: `/cases/${c.id}`,
      accountId: c.account_id,
      merchant: c.account_id ? app.merchantName(c.account_id) : "Platform",
      reason: caseKindLabel(c.kind),
      created: c.created,
      severity: c.severity,
    })),
    ...(kyb.data?.data ?? []).map((k) => ({
      key: `kyb-${k.account_id}`,
      ref: kybRef(k.account_id),
      href: `/kyb/${k.account_id}`,
      accountId: k.account_id,
      merchant: k.account_display_name,
      reason: "Business details review",
      created: k.submitted_at ?? k.created,
      severity: "medium",
    })),
  ]
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.created - b.created)
    .slice(0, 8);

  const columns: TableColumn<QueueRow>[] = [
    { key: "case", header: "Case", primary: true, cell: (r) => r.ref },
    { key: "merchant", header: "Merchant", cell: (r) => r.merchant ?? "…" },
    { key: "reason", header: "Reason", cell: (r) => r.reason },
    { key: "age", header: "Age", numeric: true, hideOnNarrow: true, cell: (r) => formatAge(r.created, now) },
    {
      key: "priority",
      header: "Priority",
      cell: (r) =>
        r.severity === "medium" || r.severity === "low" ? (
          severityLabel(r.severity)
        ) : (
          <StatusBadge tone={PRIORITY_TONE[r.severity as keyof typeof PRIORITY_TONE] ?? "neutral"}>
            {severityLabel(r.severity)}
          </StatusBadge>
        ),
    },
  ];

  const queueLoading = cases.loading || kyb.loading;
  const queueError = cases.error ?? kyb.error;

  return (
    <Shell section="overview">
      <Page>
        <Header title="Operations overview" subtitle="Review exceptions and keep merchant payments moving." />
        <StatGroup className="c-stats">
          <Stat
            label="Payment reviews"
            value={holds.loading ? <Skeleton shape="stat" width="25" /> : holds.error ? "—" : heldCount}
            sub={
              holds.error ? (
                "Could not load holds"
              ) : holds.loading ? (
                "Loading…"
              ) : heldCount === "0" ? (
                "Nothing held"
              ) : (
                <Link to="/holds">{oldestHeld ? `Oldest held ${formatAge(oldestHeld, now)}` : "Open holds"}</Link>
              )
            }
          />
          <Stat
            label="Business reviews"
            value={kyb.loading ? <Skeleton shape="stat" width="25" /> : kyb.error ? "—" : count(kyb.data)}
            sub={
              kyb.error ? "Could not load reviews" : kyb.loading ? "Loading…" : <Link to="/kyb">Awaiting review</Link>
            }
          />
          <Stat
            label="Reconciliation"
            value={
              exceptions.loading ? (
                <Skeleton shape="stat" width="50" />
              ) : exceptions.error ? (
                "—"
              ) : (
                `${exceptionCount}${exceptions.data?.has_more ? "+" : ""} ${exceptionCount === 1 ? "exception" : "exceptions"}`
              )
            }
            sub={
              lastRun.loading
                ? "Loading…"
                : latest
                  ? `Last run · ${formatTime(latest.completed_at ?? latest.started_at)}`
                  : "No runs yet"
            }
          />
        </StatGroup>
        <Section
          title="Needs attention"
          description="Open cases and business reviews, highest priority first."
          actions={<Link to="/cases">View all cases</Link>}
        >
          {queueError ? (
            <ErrorState
              error={queueError}
              onRetry={() => {
                cases.reload();
                kyb.reload();
              }}
            />
          ) : (
            <Table
              caption="Cases needing attention"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
              rowHref={(r) => app.href(r.href)}
              loading={queueLoading}
              empty="Nothing needs attention right now."
            />
          )}
        </Section>
        <Callout tone="info" title="Operational actions are recorded">
          Payment decisions require evidence. Sensitive changes may need a second approver.
        </Callout>
      </Page>
    </Shell>
  );
}
