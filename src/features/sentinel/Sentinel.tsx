/**
 * Sentinel: the global kill switch (engage alone, no step-up so an emergency is never delayed;
 * release needs a request and a second operator's approval) and audit findings (sentinel routes).
 */

import type { z } from "@nearpay/spec";
import {
  approveOpsKillSwitchRelease,
  engageOpsKillSwitch,
  getOpsKillSwitch,
  listOpsFindings,
  listOpsKillSwitchLog,
  type OpsAuditFinding,
  rejectOpsKillSwitchRelease,
  requestOpsKillSwitchRelease,
} from "@nearpay-internal/spec";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  Field,
  Pager,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  type TableColumn,
  Tabs,
  useToast,
} from "@nearpay-internal/ui";
import { useId, useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { findingResultLabel, formatAge, formatDateTime, shortRef } from "../../lib/format";
import { useAsync, useNow, usePaged } from "../../lib/hooks";
import { ApprovalCard } from "../../ui/Approval";
import { ModeFilter } from "../../ui/ModeFilter";
import { ActionDialog, ErrorState, FilterBar, GateNote, Header, Page, Section } from "../../ui/ui";

type Finding = z.output<typeof OpsAuditFinding>;

export const RESULT_TONE = { pass: "success", mismatch: "danger", unverifiable: "warning" } as const;
export const findingRef = (id: string) => shortRef("AU", id);

export function Sentinel() {
  const app = useApp();
  const initial = new URLSearchParams(app.location.search).get("tab") === "findings" ? "findings" : "switch";
  const [tab, setTab] = useState(initial);
  return (
    <Shell section="sentinel">
      <Page wide>
        <Header
          title="Sentinel"
          subtitle="Independent checks of settlements, and the switch that stops live quoting."
        />
        <Tabs
          label="Sentinel"
          items={[
            { id: "switch", label: "Kill switch" },
            { id: "findings", label: "Findings" },
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            window.history.replaceState(null, "", app.href(t === "findings" ? "/sentinel?tab=findings" : "/sentinel"));
          }}
        >
          {tab === "switch" ? <KillSwitch /> : <Findings />}
        </Tabs>
      </Page>
    </Shell>
  );
}

function KillSwitch() {
  const app = useApp();
  const toast = useToast();
  const ks = useAsync(() => app.api.call(getOpsKillSwitch), []);
  const [dialog, setDialog] = useState<"engage" | "release" | null>(null);
  const [logCursor, setLogCursor] = useState<(number | undefined)[]>([undefined]);
  const before = logCursor[logCursor.length - 1];
  const log = useAsync(
    () => app.api.call(listOpsKillSwitchLog, { query: { limit: 10, before_version: before } }),
    [before, ks.data?.version],
  );
  const ids = useId();

  if (ks.loading && !ks.data)
    return (
      <div className="np-stack" aria-busy="true">
        <span className="np-sr-only" role="status">
          Loading kill switch…
        </span>
        <Skeleton shape="block" />
      </div>
    );
  if (ks.error || !ks.data) return <ErrorState error={ks.error} onRetry={ks.reload} />;

  const s = ks.data;
  const engageBlocked = app.blocked(engageOpsKillSwitch);
  const releaseBlocked = app.blocked(requestOpsKillSwitchRelease);
  const lastEntry = log.data?.data[log.data.data.length - 1];

  return (
    <div className="np-stack np-stack--lg">
      <Card as="section" aria-labelledby={`${ids}-ks`} className={s.engaged ? "c-ks c-ks--engaged" : "c-ks"}>
        <div className="c-ks__body">
          <div className="np-stack np-stack--sm">
            <div className="np-row">
              <CardTitle>
                <span id={`${ids}-ks`}>Live quoting</span>
              </CardTitle>
              <StatusBadge tone={s.engaged ? "danger" : "success"}>{s.engaged ? "Stopped" : "Running"}</StatusBadge>
            </div>
            <p>
              {s.engaged
                ? "The kill switch is engaged: no new live quotes, deposit addresses or refund legs are issued. Payments already in flight keep being verified."
                : "The kill switch is released: live payments are quoted normally."}
            </p>
            <p className="np-text-small np-text-secondary">
              Last change {formatDateTime(s.updated_at)} · {s.actor === app.session?.operator.id ? "You" : s.actor} ·{" "}
              {s.reason}
            </p>
          </div>
          <div className="c-ks__actions">
            {s.engaged ? (
              s.pending_release ? null : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setDialog("release")}
                    disabled={Boolean(releaseBlocked)}
                    aria-describedby={`${ids}-rel`}
                  >
                    Request release
                  </Button>
                  <GateNote id={`${ids}-rel`}>
                    {releaseBlocked ?? "Two-person rule: a different ops admin must approve the release."}
                  </GateNote>
                </>
              )
            ) : (
              <>
                <Button
                  variant="danger"
                  onClick={() => setDialog("engage")}
                  disabled={Boolean(engageBlocked)}
                  aria-describedby={`${ids}-eng`}
                >
                  Engage kill switch
                </Button>
                <GateNote id={`${ids}-eng`}>
                  {engageBlocked ?? "One operator can engage it at once; releasing needs two."}
                </GateNote>
              </>
            )}
          </div>
        </div>
      </Card>

      {s.pending_release ? (
        <ApprovalCard
          approval={s.pending_release}
          approveLabel="Approve release"
          approveBlocked={app.blocked(approveOpsKillSwitchRelease)}
          rejectBlocked={app.blocked(rejectOpsKillSwitchRelease)}
          onApprove={async (note) => {
            const r = await app.api.call(approveOpsKillSwitchRelease, {
              params: { id: s.pending_release?.id ?? "" },
              body: note ? { note } : {},
            });
            ks.set(r);
            toast.show({ tone: "success", title: "Kill switch released", body: "Live quoting resumes." });
          }}
          onReject={async (note) => {
            await app.api.call(rejectOpsKillSwitchRelease, {
              params: { id: s.pending_release?.id ?? "" },
              body: { note },
            });
            ks.reload();
            toast.show({ tone: "info", title: "Release request closed", body: "The kill switch stays engaged." });
          }}
        />
      ) : null}

      <Section title="History">
        {log.error ? (
          <ErrorState error={log.error} onRetry={log.reload} />
        ) : (
          <Table
            caption="Kill switch history"
            columns={[
              {
                key: "change",
                header: "Change",
                primary: true,
                cell: (e) => (
                  <StatusBadge tone={e.engaged ? "danger" : "success"}>
                    {e.engaged ? "Engaged" : "Released"}
                  </StatusBadge>
                ),
              },
              { key: "reason", header: "Reason", cell: (e) => e.reason },
              { key: "actor", muted: true, header: "By", hideOnNarrow: true, cell: (e) => e.actor },
              { key: "at", muted: true, header: "When", numeric: true, cell: (e) => formatDateTime(e.created_at) },
            ]}
            rows={log.data?.data ?? []}
            rowKey={(e) => String(e.version)}
            loading={log.loading}
            empty="No changes recorded yet."
            footer={
              <Pager
                hasPrevious={logCursor.length > 1}
                hasNext={Boolean(log.data?.has_more && lastEntry)}
                onPrevious={() => setLogCursor((c) => c.slice(0, -1))}
                onNext={() => lastEntry && setLogCursor((c) => [...c, lastEntry.version])}
              />
            }
          />
        )}
      </Section>

      <ActionDialog
        open={dialog === "engage"}
        onClose={() => setDialog(null)}
        title="Engage the kill switch"
        description="Stops all new live quoting immediately. Security contacts are alerted. Releasing it later needs a second ops admin."
        noteLabel="Reason"
        noteHint="Audited and sent to the security contacts."
        confirmLabel="Engage now"
        confirmVariant="danger"
        onConfirm={async (reason) => {
          ks.set(await app.api.call(engageOpsKillSwitch, { body: { reason } }));
          toast.show({ tone: "warning", title: "Kill switch engaged", body: "Live quoting is stopped." });
        }}
      />
      <ActionDialog
        open={dialog === "release"}
        onClose={() => setDialog(null)}
        title="Request releasing the kill switch"
        description="Nothing changes until a different ops admin approves. The request expires after 1 hour."
        noteLabel="Why it is safe to resume"
        confirmLabel="Request release"
        stepUp
        onConfirm={async (reason) => {
          await app.api.call(requestOpsKillSwitchRelease, { body: { reason } });
          ks.reload();
          toast.show({ tone: "success", title: "Release requested", body: "A different ops admin must approve it." });
        }}
      />
    </div>
  );
}

function Findings() {
  const app = useApp();
  const now = useNow();
  const [result, setResult] = useState("");
  const [ack, setAck] = useState("false");
  const live = app.mode === "live" ? "true" : "false";
  const list = usePaged(
    (cursor) =>
      app.api.call(listOpsFindings, {
        query: {
          limit: 20,
          starting_after: cursor,
          result: result || undefined,
          acknowledged: ack || undefined,
          livemode: live,
        },
      }),
    (f) => f.id,
    [result, ack, live],
  );
  const columns: TableColumn<Finding>[] = [
    { key: "ref", header: "Finding", primary: true, cell: (f) => findingRef(f.id) },
    { key: "merchant", header: "Merchant", cell: (f) => app.merchantName(f.account_id) ?? "…" },
    { key: "check", muted: true, header: "Check", hideOnNarrow: true, cell: (f) => f.check_kind },
    {
      key: "result",
      header: "Result",
      cell: (f) => (
        <StatusBadge tone={RESULT_TONE[f.result as keyof typeof RESULT_TONE] ?? "neutral"}>
          {findingResultLabel(f.result)}
        </StatusBadge>
      ),
    },
    {
      key: "ack",
      header: "Acknowledged",
      hideOnNarrow: true,
      cell: (f) => (f.acknowledged_at ? formatDateTime(f.acknowledged_at) : "Open"),
    },
    { key: "age", muted: true, header: "Recorded", numeric: true, cell: (f) => formatAge(f.created, now) },
  ];
  return (
    <div className="np-stack np-stack--lg">
      <FilterBar label="Filter findings">
        <ModeFilter />
        <Field label="Result">
          <Select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">Mismatches and unverifiable</option>
            <option value="mismatch">Mismatch</option>
            <option value="unverifiable">Unverifiable</option>
            <option value="pass">Matched</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={ack} onChange={(e) => setAck(e.target.value)}>
            <option value="false">Open</option>
            <option value="true">Acknowledged</option>
            <option value="">All</option>
          </Select>
        </Field>
      </FilterBar>
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <Table
          caption="Audit findings"
          columns={columns}
          rows={list.data?.data ?? []}
          rowKey={(f) => f.id}
          rowHref={(f) => app.href(`/sentinel/findings/${f.id}`)}
          loading={list.loading}
          loadingRows={4}
          empty={
            ack === "false"
              ? "No open findings. Sentinel re-checks every settlement independently."
              : "No findings match."
          }
          footer={
            <Pager
              summary={list.data ? `Page ${list.pageIndex + 1} · ${list.data.data.length} findings` : undefined}
              hasPrevious={list.hasPrevious}
              hasNext={list.hasNext}
              onPrevious={list.previous}
              onNext={list.next}
            />
          }
        />
      )}
      <Callout tone="info" title="Findings and cases are worked separately">
        Acknowledging a finding records that you saw it. A mismatch also opens a compliance case, which you close in
        Cases.
      </Callout>
    </div>
  );
}
