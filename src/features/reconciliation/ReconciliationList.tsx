/**
 * Reconciliation (Figma "Reconciliation"): daily runs per merchant and UTC day — matched, exceptions,
 * expected vs observed, difference, result (payments `listOpsReconciliationRuns`); create a run
 * (`createOpsReconciliationRun`); export the report as CSV (built in the browser, never stored).
 */
import { createOpsReconciliationRun, listOpsReconciliationRuns } from "@nearpay-internal/spec";
import {
  Button,
  Field,
  Input,
  Pager,
  Select,
  Skeleton,
  Stat,
  StatGroup,
  StatusBadge,
  Table,
  type TableColumn,
  useToast,
} from "@nearpay-internal/ui";
import { useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { formatAssetAmount } from "../../lib/assets";
import { yesterdayUtc } from "../../lib/format";
import { usePaged } from "../../lib/hooks";
import {
  isException,
  matchedPayments,
  type ReconciliationRun,
  reconciliationCsv,
  runLines,
  runResult,
  runTitle,
  totalsByAsset,
} from "../../lib/recon";
import { ModeFilter } from "../../ui/ModeFilter";
import { ActionDialog, ActionError, ErrorState, FilterBar, Header, Page, StatsSkeleton } from "../../ui/ui";

export const RESULT_TONE = (r: ReconciliationRun) =>
  r.resolution
    ? "success"
    : r.status === "ok"
      ? "success"
      : r.status === "running"
        ? "neutral"
        : r.status === "error"
          ? "danger"
          : "warning";

/** Result cell: "Matched" as plain text (Figma), anything that needs attention as a badge. */
export function ResultCell({ run }: { run: ReconciliationRun }) {
  if (run.status === "ok" && !run.resolution) return <span>{runResult(run)}</span>;
  return <StatusBadge tone={RESULT_TONE(run)}>{runResult(run)}</StatusBadge>;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ACCT_RE = /^acct_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/;

export function ReconciliationList() {
  const app = useApp();
  const toast = useToast();
  const [account] = useState(new URLSearchParams(app.location.search).get("account") ?? "");
  const [status, setStatus] = useState("");
  const [day, setDay] = useState("");
  const [creating, setCreating] = useState(false);
  const [newRun, setNewRun] = useState({ account: account, day: yesterdayUtc() });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>();
  const live = app.mode === "live" ? "true" : "false";

  const filters = {
    livemode: live,
    account: account || undefined,
    status: status === "unresolved" ? undefined : status || undefined,
    unresolved: status === "unresolved" ? ("true" as const) : undefined,
    day: day || undefined,
  };

  const list = usePaged(
    (cursor) => app.api.call(listOpsReconciliationRuns, { query: { ...filters, limit: 20, starting_after: cursor } }),
    (r) => r.id,
    [live, account, status, day],
  );

  const runs = list.data?.data ?? [];
  const totals = totalsByAsset(runs);
  const main = totals[0];
  const exceptions = runs.filter(isException).length;

  const columns: TableColumn<ReconciliationRun>[] = [
    { key: "run", header: "Run / merchant", primary: true, cell: (r) => runTitle(r, app.merchantName(r.account_id)) },
    ...(["expected", "observed", "difference"] as const).map(
      (k): TableColumn<ReconciliationRun> => ({
        key: k,
        header: k === "expected" ? "Expected" : k === "observed" ? "Observed" : "Difference",
        numeric: true,
        hideOnNarrow: k !== "difference",
        cell: (r) => {
          const lines = runLines(r);
          if (lines.length === 0) return r.status === "running" ? "…" : "—";
          return (
            <span className="c-cell-stack">
              {lines.map((l) => (
                <span key={l.assetId}>{formatAssetAmount(l[k], l.assetId)}</span>
              ))}
            </span>
          );
        },
      }),
    ),
    { key: "result", header: "Result", cell: (r) => <ResultCell run={r} /> },
  ];

  return (
    <Shell section="reconciliation">
      <Page wide>
        <Header
          title="Reconciliation"
          subtitle="Compare expected settlement with observed funds."
          actions={
            <Button onClick={() => setCreating(true)} disabled={Boolean(app.blocked(createOpsReconciliationRun))}>
              Run reconciliation
            </Button>
          }
        />
        {list.loading && !list.data ? (
          <StatsSkeleton />
        ) : (
          <StatGroup className="c-stats">
            <Stat
              label="Matched"
              value={list.loading ? <Skeleton shape="stat" width="25" /> : String(matchedPayments(runs))}
              sub="Payments"
            />
            <Stat
              label="Exceptions"
              value={String(exceptions)}
              sub={exceptions ? "Requires investigation" : "Nothing to investigate"}
            />
            <Stat
              label="Expected / observed"
              value={
                main ? (
                  <span className="c-stat-pair">
                    {formatAssetAmount(main.expected, main.assetId)} / {formatAssetAmount(main.observed, main.assetId)}
                  </span>
                ) : (
                  "—"
                )
              }
              sub={
                main
                  ? `Difference: ${formatAssetAmount(main.difference, main.assetId)}${totals.length > 1 ? ` · ${totals.length - 1} more asset${totals.length > 2 ? "s" : ""} in the table` : ""}`
                  : "No runs on this page"
              }
            />
          </StatGroup>
        )}
        <FilterBar label="Filter reconciliation runs">
          <ModeFilter />
          <Field label="Result">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any result</option>
              <option value="unresolved">Unresolved exceptions</option>
              <option value="ok">Matched</option>
              <option value="diff">Review (differences)</option>
              <option value="error">Failed</option>
              <option value="running">Running</option>
            </Select>
          </Field>
          <Field label="Day (UTC)">
            <Input type="date" value={day} max={yesterdayUtc()} onChange={(e) => setDay(e.target.value)} />
          </Field>
        </FilterBar>
        {account ? (
          <p className="np-text-small np-text-secondary">
            Showing runs of {app.merchantName(account) ?? account} only.
          </p>
        ) : null}
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            caption="Reconciliation runs"
            columns={columns}
            rows={runs}
            rowKey={(r) => r.id}
            rowHref={(r) => app.href(`/reconciliation/${r.id}`)}
            loading={list.loading}
            loadingRows={4}
            empty="No reconciliation runs match. Runs are created daily at 02:00 UTC for the previous day."
            footer={
              <Pager
                summary={list.data ? `Page ${list.pageIndex + 1} · ${runs.length} runs` : undefined}
                hasPrevious={list.hasPrevious}
                hasNext={list.hasNext}
                onPrevious={list.previous}
                onNext={list.next}
              />
            }
          />
        )}
        <div className="np-stack np-stack--sm c-export">
          <div>
            <Button
              variant="secondary"
              loading={exporting}
              loadingText="Preparing report…"
              onClick={async () => {
                setExporting(true);
                setExportError(undefined);
                try {
                  const all: ReconciliationRun[] = [];
                  let cursor: string | undefined;
                  for (let i = 0; i < 10; i++) {
                    const page = await app.api.call(listOpsReconciliationRuns, {
                      query: { ...filters, limit: 100, starting_after: cursor },
                    });
                    all.push(...page.data);
                    const last = page.data[page.data.length - 1];
                    if (!page.has_more || !last) break;
                    cursor = last.id;
                  }
                  const names = new Map<string, string>();
                  for (const r of all) {
                    const n = app.merchantName(r.account_id);
                    if (n) names.set(r.account_id, n);
                  }
                  download(
                    `nearpay-reconciliation-${app.mode}-${day || new Date().toISOString().slice(0, 10)}.csv`,
                    reconciliationCsv(all, (id) => names.get(id)),
                  );
                  toast.show({ tone: "success", title: "Report exported", body: `${all.length} runs.` });
                } catch (e) {
                  setExportError(e);
                } finally {
                  setExporting(false);
                }
              }}
            >
              Export report
            </Button>
          </div>
          <p className="np-text-caption np-text-secondary">
            CSV with exact base units and display amounts, for the filters above (up to 1,000 runs).
          </p>
          <ActionError error={exportError} />
        </div>

        <ActionDialog
          open={creating}
          onClose={() => setCreating(false)}
          title="Run reconciliation"
          description={`Reconciles one merchant’s completed UTC day in ${app.mode} mode. A re-run never edits an earlier run; it records a new one.`}
          confirmLabel="Start run"
          validate={() =>
            !ACCT_RE.test(newRun.account.trim())
              ? "Enter the merchant’s account id (acct_…)."
              : !/^\d{4}-\d{2}-\d{2}$/.test(newRun.day)
                ? "Choose a day."
                : null
          }
          onConfirm={async () => {
            const r = await app.api.call(createOpsReconciliationRun, {
              body: { account_id: newRun.account.trim(), livemode: app.mode === "live", day: newRun.day },
            });
            toast.show({ tone: "success", title: "Reconciliation started" });
            app.navigate(app.href(`/reconciliation/${r.id}`));
          }}
        >
          <Field label="Merchant account id" required hint="From the merchant’s page, e.g. acct_01…">
            <Input
              value={newRun.account}
              onChange={(e) => setNewRun({ ...newRun, account: e.target.value })}
              autoComplete="off"
              spellCheck={false}
              className="c-mono-input"
            />
          </Field>
          <Field label="Day (UTC)" required hint="Only completed days can be reconciled.">
            <Input
              type="date"
              value={newRun.day}
              max={yesterdayUtc()}
              onChange={(e) => setNewRun({ ...newRun, day: e.target.value })}
            />
          </Field>
        </ActionDialog>
      </Page>
    </Shell>
  );
}
