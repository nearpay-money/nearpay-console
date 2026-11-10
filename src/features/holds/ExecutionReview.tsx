/**
 * Review screen of an execution (Figma "Review RV-xxxx" — "Resolve with evidence"). Operators can
 * ask the Verifier to re-check (`reverifyOpsExecution`, step-up) or escalate the linked compliance
 * case; nothing here can force a state. Only evidence moves a payment to succeeded (INV-2): there is
 * no "mark paid" override.
 */

import type { z } from "@nearpay/spec";
import {
  assignOpsCase,
  commentOpsCase,
  getOpsExecution,
  listOpsCases,
  listOpsExecutionObservations,
  type ProviderObservation,
  reverifyOpsExecution,
} from "@nearpay-internal/spec";
import {
  Button,
  buttonClassName,
  Callout,
  Card,
  CardTitle,
  ExternalLinkIcon,
  Field,
  KeyValueList,
  StatusBadge,
  Table,
  Timeline,
  useToast,
} from "@nearpay-internal/ui";
import { useEffect, useId, useState } from "react";
import { Link, useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { assetLabel, formatAssetAmount } from "../../lib/assets";
import { canReverify, finalityRecheckOf, type ReviewCheck, reviewChecks } from "../../lib/checks";
import {
  executionRef,
  executionStateLabel,
  formatDateTime,
  formatTimeSeconds,
  heldReasonLabel,
  isoOf,
  observationSourceLabel,
  paymentRef,
  refundRef,
} from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { ActionError, DetailSkeleton, ErrorState, Header, IdText, Page, Section, Textarea } from "../../ui/ui";
import { STATE_TONE } from "./HoldsList";

type Observation = z.output<typeof ProviderObservation>;

const HELD_COPY: Readonly<Record<string, string>> = {
  evidence_timeout:
    "The payment was detected, but the required settlement evidence is not complete. The merchant has not been told to fulfill.",
  evidence_mismatch:
    "Settlement evidence does not match what was expected (recipient, asset or amount). The merchant has not been told to fulfill.",
  failed_after_deposit:
    "The provider reported a failure after the payer’s deposit; the provider may return the funds to the payer. The merchant has not been told to fulfill.",
  unknown_status:
    "The provider returned a status NearPay does not recognise, so the payment is held until evidence settles it. The merchant has not been told to fulfill.",
};

export const httpsOnly = (u: string | null | undefined) => (u && /^https:\/\//.test(u) ? u : null);

export function ExecutionReview({ id }: { id: string }) {
  const app = useApp();
  const toast = useToast();
  const ex = useAsync(() => app.api.call(getOpsExecution, { params: { id } }), [id]);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reverify" | "escalate" | null>(null);
  const [error, setError] = useState<unknown>();
  const [obs, setObs] = useState<Observation[]>([]);
  const [obsMore, setObsMore] = useState(false);
  const [obsState, setObsState] = useState<{ loading: boolean; error: unknown }>({ loading: true, error: undefined });
  const [obsTick, setObsTick] = useState(0);
  const ids = useId();

  const e = ex.data;
  const linkedCase = useAsync(
    async () =>
      e
        ? (
            await app.api.call(listOpsCases, {
              query: {
                account: e.account_id,
                kind: "held_execution",
                livemode: e.livemode ? "true" : "false",
                limit: 100,
              },
            })
          ).data.find((c) => c.subject.id === e.id)
        : undefined,
    [e?.id],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: obsTick reloads the first page
  useEffect(() => {
    let live = true;
    setObsState({ loading: true, error: undefined });
    app.api.call(listOpsExecutionObservations, { params: { id }, query: { limit: 50 } }).then(
      (r) => {
        if (!live) return;
        setObs(r.data);
        setObsMore(r.has_more);
        setObsState({ loading: false, error: undefined });
      },
      (err: unknown) => live && setObsState({ loading: false, error: err }),
    );
    return () => {
      live = false;
    };
  }, [app.api, id, obsTick]);

  if (ex.loading && !e)
    return (
      <Shell section="holds" crumbs={["Review"]}>
        <DetailSkeleton label="execution" />
      </Shell>
    );
  if (ex.error || !e)
    return (
      <Shell section="holds" crumbs={["Review"]}>
        <Page>
          <ErrorState error={ex.error} onRetry={ex.reload} title="This execution could not be loaded" />
        </Page>
      </Shell>
    );

  const ref = executionRef(e.id);
  const held = e.state === "held";
  const merchant = app.merchantName(e.account_id);
  const amount = formatAssetAmount(e.settlement.expected, e.settlement.asset_id);
  const checks = reviewChecks(e, linkedCase.loading ? undefined : linkedCase.data ? linkedCase.data.review : undefined);
  const reverifyBlocked = app.blocked(reverifyOpsExecution);
  const kase = linkedCase.data;
  const explorer = httpsOnly(e.evidence?.explorer_url);
  // the newest finality re-check observation decides the flag on the trail
  const recheck = obs.reduce<ReturnType<typeof finalityRecheckOf>>((last, o) => finalityRecheckOf(o) ?? last, null);
  const recheckAlert = recheck && (recheck.outcome === "failed" || recheck.outcome === "timeout") ? recheck : null;

  const requireNote = () => {
    if (!note.trim()) {
      setNoteError("Add the evidence you checked and the reason for your action.");
      return false;
    }
    setNoteError(null);
    return true;
  };

  const loadMoreObs = async () => {
    const last = obs[obs.length - 1];
    if (!last) return;
    try {
      const r = await app.api.call(listOpsExecutionObservations, {
        params: { id },
        query: { limit: 50, starting_after: last.id },
      });
      setObs((o) => [...o, ...r.data]);
      setObsMore(r.has_more);
    } catch (err) {
      setObsState({ loading: false, error: err });
    }
  };

  return (
    <Shell section="holds" crumbs={[ref]}>
      <Page>
        <Header
          title={held ? `Review ${ref}` : `Execution ${ref}`}
          subtitle={
            <>
              <Link to={`/merchants/${e.account_id}`}>{merchant ?? e.account_id}</Link>
              {e.reference ? (
                e.kind === "refund" && e.reference.refund ? (
                  <>
                    {" · "}
                    <Link to={`/refunds/${e.reference.refund}`}>Refund {refundRef(e.reference.refund)}</Link>
                    {` of payment ${paymentRef(e.reference.payment_intent)}`}
                  </>
                ) : (
                  ` · Payment ${paymentRef(e.reference.payment_intent)}`
                )
              ) : null}
            </>
          }
          status={
            <span className="np-row">
              <StatusBadge tone={STATE_TONE[e.state] ?? "neutral"}>{executionStateLabel(e.state)}</StatusBadge>
              {e.livemode ? null : <StatusBadge tone="warning">Test</StatusBadge>}
            </span>
          }
        />

        <div className="c-two-col c-two-col--review">
          <div className="c-panel np-stack--lg">
            <div className="np-stack">
              <h2 className="np-text-h3">
                {held
                  ? `${amount} ${e.kind === "refund" ? "refund" : "payment"} under review`
                  : `${amount} ${e.kind === "refund" ? "refund" : "payment"} · ${executionStateLabel(e.state).toLowerCase()}`}
              </h2>
              {held ? (
                <p className="c-lede">
                  {HELD_COPY[e.held_reason ?? ""] ??
                    "The Verifier held this payment until settlement evidence is complete. The merchant has not been told to fulfill."}
                </p>
              ) : null}
              {e.held_reason ? (
                <p className="np-text-small np-text-secondary">Held reason: {heldReasonLabel(e.held_reason)}</p>
              ) : null}
            </div>

            <Table<ReviewCheck>
              caption="Evidence checks"
              columns={[
                { key: "check", header: "Check", primary: true, cell: (c) => c.label },
                {
                  key: "result",
                  header: "Result",
                  cell: (c) =>
                    c.badge ? (
                      <StatusBadge tone={c.tone}>{c.result}</StatusBadge>
                    ) : (
                      <span className="np-text-small np-text-secondary">{c.result}</span>
                    ),
                },
              ]}
              rows={checks}
              rowKey={(c) => c.id}
            />

            <Field
              label="Decision note"
              hint="Recorded with your action in the audit log and on the case."
              error={noteError ?? undefined}
            >
              <Textarea
                value={note}
                maxLength={2000}
                rows={2}
                placeholder="Add evidence and reason for your action"
                onChange={(ev) => setNote(ev.target.value)}
              />
            </Field>
          </div>

          <Card as="aside" aria-labelledby={`${ids}-r`} className="c-side-card c-resolve">
            <div className="np-stack np-stack--lg">
              <CardTitle>
                <span id={`${ids}-r`}>Resolve with evidence</span>
              </CardTitle>
              <p className="c-lede">A manual decision cannot substitute for verified settlement.</p>
              <div className="np-stack">
                <Button
                  fullWidth
                  loading={busy === "reverify"}
                  disabled={Boolean(reverifyBlocked) || !canReverify(e)}
                  aria-describedby={`${ids}-rh`}
                  onClick={async () => {
                    if (!requireNote()) return;
                    setBusy("reverify");
                    setError(undefined);
                    try {
                      const r = await app.api.call(reverifyOpsExecution, {
                        params: { id: e.id },
                        body: { note: note.trim() },
                      });
                      ex.set(r);
                      setNote("");
                      setObsTick((t) => t + 1);
                      toast.show({
                        tone: "success",
                        title: "Investigation requested",
                        body: "The Verifier re-checks the evidence now. Only evidence can complete the payment.",
                      });
                    } catch (err) {
                      setError(err);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Request investigation
                </Button>
                <Button
                  variant="secondary"
                  fullWidth
                  loading={busy === "escalate"}
                  disabled={!kase || kase.status === "closed" || Boolean(app.blocked(commentOpsCase))}
                  aria-describedby={`${ids}-eh`}
                  onClick={async () => {
                    if (!kase || !requireNote()) return;
                    setBusy("escalate");
                    setError(undefined);
                    try {
                      if (kase.assignee !== app.session?.operator.id)
                        await app.api.call(assignOpsCase, {
                          params: { id: kase.id },
                          body: { assignee: app.session?.operator.id ?? null },
                        });
                      await app.api.call(commentOpsCase, {
                        params: { id: kase.id },
                        body: { note: `Escalated from review ${ref}: ${note.trim()}` },
                      });
                      toast.show({ tone: "success", title: "Case escalated", body: "Assigned to you with your note." });
                      app.navigate(app.href(`/cases/${kase.id}`));
                    } catch (err) {
                      setError(err);
                      setBusy(null);
                    }
                  }}
                >
                  Escalate case
                </Button>
              </div>
              <div className="np-stack np-stack--sm">
                <p id={`${ids}-rh`} className="np-text-caption np-text-secondary">
                  {reverifyBlocked ??
                    (canReverify(e)
                      ? "Asks the Verifier to re-check now (needs your security key). It never forces a state."
                      : "Only held or confirming payments can be re-checked.")}
                </p>
                <p id={`${ids}-eh`} className="np-text-caption np-text-secondary">
                  {linkedCase.loading
                    ? "Looking for the review case…"
                    : kase
                      ? kase.status === "closed"
                        ? "The review case is closed."
                        : "Assigns the review case to you and adds your note."
                      : "No open review case is linked to this payment."}
                </p>
                <p className="np-text-caption np-text-secondary">No “mark paid” override</p>
              </div>
              <ActionError error={error} />
            </div>
          </Card>
        </div>

        <div className="c-grid-2">
          <Section title="Settlement">
            <KeyValueList
              items={[
                { label: "Expected", value: amount },
                {
                  label: "Reached the merchant",
                  value: e.settled_amount ? formatAssetAmount(e.settled_amount, e.settlement.asset_id) : "Not yet",
                },
                { label: "Asset", value: assetLabel(e.settlement.asset_id) },
                { label: "Recipient", value: <code className="c-mono c-break">{e.settlement.recipient}</code> },
                { label: "Deadline", value: formatDateTime(e.deadline) },
              ]}
            />
          </Section>
          <Section title="Payer side">
            <KeyValueList
              items={[
                { label: "Paid with", value: assetLabel(e.origin.asset_id) },
                {
                  label: "Deposit address",
                  value: e.deposit ? <code className="c-mono c-break">{e.deposit.address}</code> : "Intents transfer",
                },
                {
                  label: "Deposit transactions",
                  value: e.deposit_tx_hashes.length ? (
                    <span className="c-cell-stack">
                      {e.deposit_tx_hashes.map((h) => (
                        <code key={h} className="c-mono c-break">
                          {h}
                        </code>
                      ))}
                    </span>
                  ) : (
                    "None seen"
                  ),
                },
                {
                  label: "Refunded to payer",
                  value: e.refunded_amount ? formatAssetAmount(e.refunded_amount, e.origin.asset_id) : "—",
                },
              ]}
            />
          </Section>
          <Section title="Evidence">
            {e.evidence ? (
              <div className="np-stack">
                <KeyValueList
                  items={[
                    {
                      label: "Tier",
                      value: e.evidence.tier === "A" ? "A · verified on chain" : "B · provider-attested",
                    },
                    { label: "Amount", value: formatAssetAmount(e.evidence.amount, e.evidence.asset_id) },
                    { label: "Finality", value: e.evidence.finality },
                    { label: "Source", value: e.evidence.source },
                    { label: "Accepted", value: formatDateTime(e.evidence.observed_at) },
                    { label: "Transaction", value: <code className="c-mono c-break">{e.evidence.tx_hash}</code> },
                  ]}
                />
                {explorer ? (
                  <a
                    href={explorer}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClassName({ variant: "secondary", size: "sm" })}
                  >
                    <span>View transaction</span>
                    <ExternalLinkIcon size={16} />
                    <span className="np-sr-only"> (opens in a new tab)</span>
                  </a>
                ) : null}
              </div>
            ) : (
              <Callout tone="warning" title="No accepted evidence yet">
                The payment cannot complete until the Verifier accepts settlement evidence.
              </Callout>
            )}
          </Section>
          <Section title="Provider">
            <KeyValueList
              items={[
                { label: "Provider", value: e.provider },
                { label: "Provider status", value: e.provider_status ?? "—" },
                { label: "Method", value: e.method === "route_quote" ? "Deposit address" : "Intents transfer" },
                { label: "Execution id", value: <IdText value={e.id} label="execution id" /> },
                { label: "Updated", value: formatDateTime(e.updated_at) },
              ]}
            />
          </Section>
        </div>

        <Section
          title="Evidence trail"
          description="Raw provider and chain observations, oldest first."
          actions={
            recheck ? (
              <span className="c-trail-flags">
                <StatusBadge tone={recheck.tone}>{recheck.label}</StatusBadge>
              </span>
            ) : undefined
          }
        >
          {recheckAlert ? (
            <Callout tone={recheckAlert.outcome === "failed" ? "danger" : "warning"} title={recheckAlert.label} icon>
              <p>
                {`${
                  recheckAlert.outcome === "failed"
                    ? "At finality the transfer was no longer in the block that confirmed it."
                    : "The chain did not reach finality for this block within the re-check window."
                }${recheckAlert.reason ? ` Reason: ${recheckAlert.reason}.` : ""} The payment stays ${executionStateLabel(e.state).toLowerCase()}: decide with the merchant whether to refund or write it off.`}
              </p>
            </Callout>
          ) : null}
          {obsState.error ? (
            <ErrorState error={obsState.error} onRetry={() => setObsTick((t) => t + 1)} />
          ) : obsState.loading ? (
            <p className="np-text-secondary" role="status">
              Loading observations…
            </p>
          ) : obs.length === 0 ? (
            <p className="np-text-secondary">No observations recorded yet.</p>
          ) : (
            <div className="np-stack">
              <Timeline
                label="Evidence trail"
                items={obs.map((o) => {
                  const fr = finalityRecheckOf(o);
                  const title = `${observationSourceLabel(o.source)}${o.provider_status ? ` · ${o.provider_status}` : ""}`;
                  return {
                    id: o.id,
                    time: formatTimeSeconds(o.observed_at),
                    dateTime: isoOf(o.observed_at),
                    title: fr ? (
                      <>
                        {title} <StatusBadge tone={fr.tone}>{fr.label}</StatusBadge>
                      </>
                    ) : (
                      title
                    ),
                    body: `${formatDateTime(o.observed_at)} · ${o.applied ? "Changed the execution" : "No change"} · sha256 ${o.payload_sha256.slice(0, 12)}…${o.archive ? " · archived" : ""}`,
                    state:
                      fr && fr.outcome !== "finalized"
                        ? "attention"
                        : o.source === "operator"
                          ? "info"
                          : o.applied
                            ? "done"
                            : "pending",
                  };
                })}
              />
              {obsMore ? (
                <div>
                  <Button variant="secondary" size="sm" onClick={() => void loadMoreObs()}>
                    Load more observations
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Section>
      </Page>
    </Shell>
  );
}
