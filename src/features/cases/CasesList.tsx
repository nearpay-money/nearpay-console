/** Compliance cases (compliance `listOpsCases`; default: not closed, highest severity first, then oldest). */

import { type ComplianceCase, listOpsCases } from "@nearpay-internal/spec";
import { Field, Pager, Select, StatusBadge, Table, type TableColumn } from "@nearpay-internal/ui";
import type { z } from "@nearpay-money/spec";
import { useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { caseKindLabel, caseRef, caseStatusLabel, formatAge, severityLabel } from "../../lib/format";
import { useNow, usePaged } from "../../lib/hooks";
import { ModeFilter } from "../../ui/ModeFilter";
import { ErrorState, FilterBar, Header, Page } from "../../ui/ui";

export type Case = z.output<typeof ComplianceCase>;

export const SEVERITY_TONE = { critical: "danger", high: "warning", medium: "neutral", low: "neutral" } as const;
export const CASE_STATUS_TONE = { open: "warning", investigating: "progress", closed: "neutral" } as const;

export function CasesList() {
  const app = useApp();
  const now = useNow();
  const initialAccount = new URLSearchParams(app.location.search).get("account") ?? "";
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [severity, setSeverity] = useState("");
  const [mine, setMine] = useState("");
  const [account] = useState(initialAccount);
  const me = app.session?.operator.id;

  const list = usePaged(
    (cursor) =>
      app.api.call(listOpsCases, {
        query: {
          limit: 20,
          starting_after: cursor,
          status: status || undefined,
          kind: kind || undefined,
          severity: severity || undefined,
          assignee: mine === "me" ? me : undefined,
          account: account || undefined,
          livemode: app.mode === "live" ? "true" : "false",
        },
      }),
    (c) => c.id,
    [status, kind, severity, mine, account, app.mode],
  );

  const columns: TableColumn<Case>[] = [
    { key: "ref", header: "Case", primary: true, cell: (c) => caseRef(c.kind, c.id) },
    {
      key: "merchant",
      header: "Merchant",
      cell: (c) => (c.account_id ? (app.merchantName(c.account_id) ?? "…") : "Platform"),
    },
    { key: "kind", header: "Reason", cell: (c) => caseKindLabel(c.kind) },
    {
      key: "severity",
      header: "Priority",
      cell: (c) => (
        <StatusBadge tone={SEVERITY_TONE[c.severity as keyof typeof SEVERITY_TONE] ?? "neutral"}>
          {severityLabel(c.severity)}
        </StatusBadge>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (c) => (
        <StatusBadge tone={CASE_STATUS_TONE[c.status as keyof typeof CASE_STATUS_TONE] ?? "neutral"}>
          {caseStatusLabel(c.status)}
        </StatusBadge>
      ),
    },
    {
      key: "assignee",
      muted: true,
      header: "Assignee",
      hideOnNarrow: true,
      cell: (c) => (c.assignee ? (c.assignee === me ? "You" : c.assignee) : "Unassigned"),
    },
    {
      key: "age",
      muted: true,
      header: "Age",
      numeric: true,
      hideOnNarrow: true,
      cell: (c) => formatAge(c.created, now),
    },
  ];

  return (
    <Shell section="cases">
      <Page wide>
        <Header
          title="Cases"
          subtitle="Screening hits, held payments, audit mismatches and settlement differences, in one queue."
        />
        <FilterBar label="Filter cases">
          <ModeFilter />
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Open and investigating</option>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="closed">Closed</option>
            </Select>
          </Field>
          <Field label="Reason">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Any reason</option>
              <option value="held_execution">Payment needs review</option>
              <option value="reconciliation_diff">Settlement mismatch</option>
              <option value="screening_hit">Screening hit</option>
              <option value="post_screen_hit">Post-settlement screening hit</option>
              <option value="audit_mismatch">Settlement audit mismatch</option>
              <option value="merchant_report">Merchant report</option>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Any priority</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Normal</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Assignee">
            <Select value={mine} onChange={(e) => setMine(e.target.value)}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
            </Select>
          </Field>
        </FilterBar>
        {account ? (
          <p className="np-text-small np-text-secondary">
            Showing cases of {app.merchantName(account) ?? account} only.
          </p>
        ) : null}
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            caption="Compliance cases"
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(c) => c.id}
            rowHref={(c) => app.href(`/cases/${c.id}`)}
            loading={list.loading}
            loadingRows={5}
            empty="No cases match these filters."
            footer={
              <Pager
                summary={list.data ? `Page ${list.pageIndex + 1} · ${list.data.data.length} cases` : undefined}
                hasPrevious={list.hasPrevious}
                hasNext={list.hasNext}
                onPrevious={list.previous}
                onNext={list.next}
              />
            }
          />
        )}
      </Page>
    </Shell>
  );
}
