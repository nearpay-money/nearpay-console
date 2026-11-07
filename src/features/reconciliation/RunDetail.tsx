/**
 * Reconciliation run detail (payments `getOpsReconciliationRun`): per-asset totals, diffs, error,
 * resolution (`resolveOpsReconciliationRun`, step-up) and re-run (`createOpsReconciliationRun`).
 * Resolving closes the run's question, not the books; the `reconciliation_diff` case is closed in Cases.
 */

import type { z } from "@nearpay/spec";
import {
  createOpsReconciliationRun,
  getOpsReconciliationRun,
  type ReconciliationDiff,
  resolveOpsReconciliationRun,
} from "@nearpay-internal/spec";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  Field,
  KeyValueList,
  Select,
  Stat,
  StatGroup,
  Table,
  useToast,
} from "@nearpay-internal/ui";
import { useId, useState } from "react";
import { Link, useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { assetLabel, formatAssetAmount } from "../../lib/assets";
import { formatDateTime, formatDay, reconClassificationLabel, reconDiffLabel, runRef } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { isException, runLines } from "../../lib/recon";
import {
  ActionDialog,
  ActionError,
  DetailSkeleton,
  ErrorState,
  GateNote,
  Header,
  IdText,
  Page,
  Section,
} from "../../ui/ui";
import { ResultCell } from "./ReconciliationList";

type Diff = z.output<typeof ReconciliationDiff>;

const CLASSIFICATIONS = [
  ["missed_event", "Missed event (backfilled)"],
  ["fee_drift", "Fee drift (fee adjustment line)"],
  ["provider_data", "Provider data issue"],
  ["real_loss", "Real loss"],
  ["other", "Other"],
] as const;

export function RunDetail({ id }: { id: string }) {
  const app = useApp();
  const toast = useToast();
  const run = useAsync(() => app.api.call(getOpsReconciliationRun, { params: { id } }), [id]);
  const [resolving, setResolving] = useState(false);
  const [classification, setClassification] = useState("");
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState<unknown>();
  const ids = useId();

  if (run.loading && !run.data)
    return (
      <Shell section="reconciliation" crumbs={["Run"]}>
        <DetailSkeleton label="reconciliation run" />
      </Shell>
    );
  if (run.error || !run.data)
    return (
      <Shell section="reconciliation" crumbs={["Run"]}>
        <Page>
          <ErrorState error={run.error} onRetry={run.reload} title="This run could not be loaded" />
        </Page>
      </Shell>
    );

  const r = run.data;
  const merchant = app.merchantName(r.account_id);
  const lines = runLines(r);
  const main = lines[0];
  const resolveBlocked = app.blocked(resolveOpsReconciliationRun);
  const needsResolution = isException(r);

  const diffColumns = [
    { key: "kind", header: "Difference", primary: true, cell: (d: Diff) => reconDiffLabel(d.kind) },
    { key: "detail", header: "Detail", cell: (d: Diff) => d.detail },
    {
      key: "statement",
      header: "Statement",
      numeric: true,
      hideOnNarrow: true,
      cell: (d: Diff) => (d.statement_amount ? formatAssetAmount(d.statement_amount, d.asset_id) : "—"),
    },
    {
      key: "evidence",
      header: "Evidence",
      numeric: true,
      hideOnNarrow: true,
      cell: (d: Diff) => (d.evidence_amount ? formatAssetAmount(d.evidence_amount, d.asset_id) : "—"),
    },
    {
      key: "object",
      header: "Object",
      cell: (d: Diff) =>
        d.execution_id ? (
          <Link to={`/executions/${d.execution_id}`}>Execution</Link>
        ) : d.refund ? (
          <Link to={`/refunds/${d.refund}`}>Refund</Link>
        ) : (
          (d.balance_transaction ?? d.payment_intent ?? "—")
        ),
    },
  ];

  return (
    <Shell section="reconciliation" crumbs={[runRef(r.id)]}>
      <Page>
        <Header
          title={`${formatDay(r.day, true)} · ${merchant ?? "Merchant"}`}
          subtitle={
            <>
              Reconciliation {runRef(r.id)} · {r.livemode ? "Live" : "Test"} ·{" "}
              {r.trigger === "ops" ? "Operator run" : "Daily run"}
              {r.rerun_of ? (
                <>
                  {" · Re-run of "}
                  <Link to={`/reconciliation/${r.rerun_of}`}>{runRef(r.rerun_of)}</Link>
                </>
              ) : null}
            </>
          }
          status={<ResultCell run={r} />}
          actions={
            <Button
              variant="secondary"
              loading={rerunBusy}
              disabled={r.status === "running" || Boolean(app.blocked(createOpsReconciliationRun))}
              onClick={async () => {
                setRerunBusy(true);
                setRerunError(undefined);
                try {
                  const n = await app.api.call(createOpsReconciliationRun, {
                    body: { account_id: r.account_id, livemode: r.livemode, day: r.day },
                  });
                  toast.show({ tone: "success", title: "Re-run started" });
                  app.navigate(app.href(`/reconciliation/${n.id}`));
                } catch (e) {
                  setRerunError(e);
                  setRerunBusy(false);
                }
              }}
            >
              Re-run this day
            </Button>
          }
        />
        <ActionError error={rerunError} />
        {r.status === "running" ? (
          <Callout tone="info" title="This run is still running" live>
            <p>
              Totals appear when it completes.{" "}
              <button type="button" className="np-link-button" onClick={run.reload}>
                Refresh
              </button>
            </p>
          </Callout>
        ) : null}
        <StatGroup className="c-stats">
          <Stat
            label="Expected"
            value={main ? formatAssetAmount(main.expected, main.assetId) : "—"}
            sub={main ? `${assetLabel(main.assetId)} · statement` : "No statement lines"}
          />
          <Stat
            label="Observed"
            value={main ? formatAssetAmount(main.observed, main.assetId) : "—"}
            sub={main ? `${main.executions} settled payments · verified evidence` : "No evidence"}
          />
          <Stat
            label="Difference"
            value={main ? formatAssetAmount(main.difference, main.assetId) : "—"}
            sub={`${r.diff_count} ${r.diff_count === 1 ? "difference" : "differences"} found`}
          />
        </StatGroup>
        {r.error ? (
          <Callout tone="danger" title="The run could not complete">
            {r.error}
          </Callout>
        ) : null}

        <div className="c-two-col">
          <div className="np-stack np-stack--lg">
            <Section
              title="Totals by asset"
              description="Inflow: payment lines vs settled payments. Outflow: refund lines vs settled refunds."
            >
              <Table
                caption="Totals by asset"
                columns={[
                  { key: "asset", header: "Asset", primary: true, cell: (t) => assetLabel(t.asset_id) },
                  {
                    key: "in",
                    header: "Inflow (statement / evidence)",
                    numeric: true,
                    cell: (t) =>
                      `${formatAssetAmount(t.inflow.statement, t.asset_id)} / ${formatAssetAmount(t.inflow.evidence, t.asset_id)}`,
                  },
                  {
                    key: "out",
                    header: "Outflow",
                    numeric: true,
                    hideOnNarrow: true,
                    cell: (t) =>
                      `${formatAssetAmount(t.outflow.statement, t.asset_id)} / ${formatAssetAmount(t.outflow.evidence, t.asset_id)}`,
                  },
                  {
                    key: "fees",
                    header: "Fees (expected / observed)",
                    numeric: true,
                    hideOnNarrow: true,
                    cell: (t) =>
                      `${formatAssetAmount(t.fees.expected, t.asset_id)} / ${t.fees.observed ? formatAssetAmount(t.fees.observed, t.asset_id) : "n/a"}`,
                  },
                ]}
                rows={r.totals}
                rowKey={(t) => t.asset_id}
                empty={r.status === "running" ? "Waiting for the run to finish." : "No activity on this day."}
              />
            </Section>
            <Section title="Differences">
              <Table
                caption="Differences"
                columns={diffColumns}
                rows={r.diffs}
                rowKey={(d) => `${d.kind}-${d.execution_id ?? d.balance_transaction ?? d.detail}`}
                empty={r.status === "ok" ? "None — statement and evidence match." : "No differences recorded."}
              />
            </Section>
          </div>

          <Card as="aside" aria-labelledby={`${ids}-res`} className="c-side-card">
            <div className="np-stack">
              <CardTitle>
                <span id={`${ids}-res`}>Resolution</span>
              </CardTitle>
              {r.resolution ? (
                <KeyValueList
                  layout="stacked"
                  items={[
                    { label: "Classification", value: reconClassificationLabel(r.resolution.classification) },
                    { label: "What was found and done", value: r.resolution.note },
                    {
                      label: "Resolved",
                      value: `${formatDateTime(r.resolution.resolved_at)} · ${r.resolution.actor === app.session?.operator.id ? "You" : r.resolution.actor}`,
                    },
                  ]}
                />
              ) : needsResolution ? (
                <>
                  <p className="np-text-secondary">
                    Record how the difference was explained. Corrections are new statement lines, never edits.
                  </p>
                  <Button
                    fullWidth
                    onClick={() => {
                      setClassification("");
                      setResolving(true);
                    }}
                    disabled={Boolean(resolveBlocked)}
                    aria-describedby={`${ids}-rg`}
                  >
                    Resolve with evidence
                  </Button>
                  <GateNote id={`${ids}-rg`}>{resolveBlocked ?? "Needs your security key."}</GateNote>
                </>
              ) : (
                <p className="np-text-secondary">
                  {r.status === "running"
                    ? "Available when the run completes."
                    : "Nothing to resolve: the run matched."}
                </p>
              )}
              <p className="np-text-caption np-text-secondary">
                A run with differences also opens a settlement-mismatch case.{" "}
                <Link to={`/cases?account=${r.account_id}`}>Open the merchant’s cases</Link> to close it after
                resolving.
              </p>
              <p className="np-text-caption np-text-secondary">
                Run id <IdText value={r.id} label="run id" />
              </p>
            </div>
          </Card>
        </div>

        <ActionDialog
          open={resolving}
          onClose={() => setResolving(false)}
          title={`Resolve ${runRef(r.id)}`}
          description="Closes this run’s question (RB-05). It does not change the books or close the compliance case."
          noteLabel="What was found and done"
          noteMax={2000}
          confirmLabel="Record resolution"
          stepUp
          validate={() => (classification ? null : "Choose a classification.")}
          onConfirm={async (note) => {
            const n = await app.api.call(resolveOpsReconciliationRun, {
              params: { id: r.id },
              body: { classification: classification as (typeof CLASSIFICATIONS)[number][0], note },
            });
            run.set(n);
            toast.show({ tone: "success", title: "Resolution recorded" });
          }}
        >
          <Field label="Classification" required>
            <Select value={classification} onChange={(e) => setClassification(e.target.value)} placeholder="Choose">
              {CLASSIFICATIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </ActionDialog>
      </Page>
    </Shell>
  );
}
