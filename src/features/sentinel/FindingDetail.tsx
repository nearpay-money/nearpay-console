/** Audit finding detail and acknowledgement (sentinel `getOpsFinding`, `acknowledgeOpsFinding`). */
import { acknowledgeOpsFinding, getOpsFinding } from "@nearpay-internal/spec";
import { Button, Card, CardTitle, KeyValueList, StatusBadge, useToast } from "@nearpay-internal/ui";
import { useId, useState } from "react";
import { Link, useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { executionRef, findingResultLabel, formatDateTime, humanize } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { ActionDialog, DetailSkeleton, ErrorState, GateNote, Header, IdText, Page, Section } from "../../ui/ui";
import { findingRef, RESULT_TONE } from "./Sentinel";

function detailValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function FindingDetail({ id }: { id: string }) {
  const app = useApp();
  const toast = useToast();
  const f = useAsync(() => app.api.call(getOpsFinding, { params: { id } }), [id]);
  const [acking, setAcking] = useState(false);
  const ids = useId();

  if (f.loading && !f.data)
    return (
      <Shell section="sentinel" crumbs={["Finding"]}>
        <DetailSkeleton label="finding" />
      </Shell>
    );
  if (f.error || !f.data)
    return (
      <Shell section="sentinel" crumbs={["Finding"]}>
        <Page>
          <ErrorState error={f.error} onRetry={f.reload} title="This finding could not be loaded" />
        </Page>
      </Shell>
    );
  const d = f.data;
  const blocked = app.blocked(acknowledgeOpsFinding);
  const canAck = !d.acknowledged_at && d.result !== "pass";
  return (
    <Shell section="sentinel" crumbs={["Findings", findingRef(d.id)]}>
      <Page>
        <Header
          title={`Finding ${findingRef(d.id)}`}
          subtitle={
            <>
              <Link to={`/merchants/${d.account_id}`}>{app.merchantName(d.account_id) ?? d.account_id}</Link>
              {" · Recorded "}
              {formatDateTime(d.created)}
            </>
          }
          status={
            <span className="np-row">
              <StatusBadge tone={RESULT_TONE[d.result as keyof typeof RESULT_TONE] ?? "neutral"}>
                {findingResultLabel(d.result)}
              </StatusBadge>
              {d.livemode ? null : <StatusBadge tone="warning">Test</StatusBadge>}
            </span>
          }
        />
        <div className="c-two-col">
          <div className="np-stack np-stack--lg">
            <Section title="What was checked">
              <KeyValueList
                items={[
                  { label: "Check", value: d.check_kind },
                  {
                    label: "Execution",
                    value: <Link to={`/executions/${d.execution_id}`}>{executionRef(d.execution_id)}</Link>,
                  },
                  { label: "Settlement chain", value: d.tx_chain ?? "—" },
                  {
                    label: "Settlement transaction",
                    value: d.tx_hash ? <code className="c-mono c-break">{d.tx_hash}</code> : "—",
                  },
                  { label: "Finding id", value: <IdText value={d.id} label="finding id" /> },
                ]}
              />
            </Section>
            <Section title="Details">
              {Object.keys(d.details).length ? (
                <KeyValueList
                  items={Object.entries(d.details).map(([k, v]) => ({ label: humanize(k), value: detailValue(v) }))}
                />
              ) : (
                <p className="np-text-secondary">No details recorded.</p>
              )}
            </Section>
          </div>
          <Card as="aside" aria-labelledby={`${ids}-a`} className="c-side-card">
            <div className="np-stack">
              <CardTitle>
                <span id={`${ids}-a`}>Acknowledgement</span>
              </CardTitle>
              {d.acknowledged_at ? (
                <KeyValueList
                  layout="stacked"
                  items={[
                    {
                      label: "Acknowledged",
                      value: `${formatDateTime(d.acknowledged_at)} · ${d.acknowledged_by === app.session?.operator.id ? "You" : (d.acknowledged_by ?? "—")}`,
                    },
                    { label: "Note", value: d.acknowledgement_note ?? "—" },
                  ]}
                />
              ) : d.result === "pass" ? (
                <p className="np-text-secondary">Matched findings need no acknowledgement.</p>
              ) : (
                <>
                  <p className="np-text-secondary">
                    Record that you have seen this finding. Work the related case in Cases.
                  </p>
                  <Button fullWidth onClick={() => setAcking(true)} disabled={Boolean(blocked) || !canAck}>
                    Acknowledge
                  </Button>
                  {blocked ? <GateNote id={`${ids}-g`}>{blocked}</GateNote> : null}
                </>
              )}
              <Link to={`/cases?account=${d.account_id}`}>Open the merchant’s cases</Link>
            </div>
          </Card>
        </div>
        <ActionDialog
          open={acking}
          onClose={() => setAcking(false)}
          title={`Acknowledge ${findingRef(d.id)}`}
          noteLabel="Note"
          noteMax={2000}
          confirmLabel="Acknowledge"
          onConfirm={async (note) => {
            f.set(await app.api.call(acknowledgeOpsFinding, { params: { id: d.id }, body: { note } }));
            toast.show({ tone: "success", title: "Finding acknowledged" });
          }}
        />
      </Page>
    </Shell>
  );
}
