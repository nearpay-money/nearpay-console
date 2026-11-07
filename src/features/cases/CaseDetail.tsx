/** Case detail: timeline, assign, note, close (compliance `getOpsCase`, `assignOpsCase`, `commentOpsCase`, `closeOpsCase`). */
import { assignOpsCase, closeOpsCase, commentOpsCase, getOpsCase } from "@nearpay-internal/spec";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  Field,
  KeyValueList,
  Select,
  StatusBadge,
  Timeline,
  useToast,
} from "@nearpay-internal/ui";
import { useId, useState } from "react";
import { Link, useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import {
  caseActionLabel,
  caseKindLabel,
  caseRef,
  caseResolutionLabel,
  caseStatusLabel,
  formatDateTime,
  formatTimeSeconds,
  isoOf,
  severityLabel,
} from "../../lib/format";
import { useAsync } from "../../lib/hooks";
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
  Textarea,
} from "../../ui/ui";
import { CASE_STATUS_TONE, SEVERITY_TONE } from "./CasesList";

const RESOLUTIONS = [
  ["no_action", "No action needed"],
  ["false_positive", "False positive"],
  ["merchant_contacted", "Merchant contacted"],
  ["destination_blocked", "Destination blocked"],
  ["account_suspended", "Account suspended"],
  ["other", "Other"],
] as const;

/** Link to what the case is about, when the console has a page for it. */
function subjectHref(type: string, id: string): string | null {
  if (type === "execution" && id.startsWith("ex_")) return `/executions/${id}`;
  if (type === "reconciliation_run" && id.startsWith("rcn_")) return `/reconciliation/${id}`;
  if (type === "account" && id.startsWith("acct_")) return `/merchants/${id}`;
  if (type === "audit_finding" && id.startsWith("fnd_")) return `/sentinel/findings/${id}`;
  if (type === "refund" && id.startsWith("re_")) return `/refunds/${id}`;
  return null;
}

export function CaseDetail({ id }: { id: string }) {
  const app = useApp();
  const toast = useToast();
  const c = useAsync(() => app.api.call(getOpsCase, { params: { id } }), [id]);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"assign" | "note" | null>(null);
  const [actionError, setActionError] = useState<unknown>();
  const [closing, setClosing] = useState(false);
  const [resolution, setResolution] = useState("");
  const gateId = useId();
  const me = app.session?.operator.id;

  if (c.loading && !c.data)
    return (
      <Shell section="cases" crumbs={["Case"]}>
        <DetailSkeleton label="case" />
      </Shell>
    );
  if (c.error || !c.data)
    return (
      <Shell section="cases" crumbs={["Case"]}>
        <Page>
          <ErrorState error={c.error} onRetry={c.reload} title="This case could not be loaded" />
        </Page>
      </Shell>
    );

  const k = c.data;
  const ref = caseRef(k.kind, k.id);
  const closed = k.status === "closed";
  const writeBlocked = app.blocked(assignOpsCase);
  const subject = subjectHref(k.subject.type, k.subject.id);
  const merchant = k.account_id ? app.merchantName(k.account_id) : undefined;

  const run = async (kind: "assign" | "note", fn: () => Promise<void>) => {
    setBusy(kind);
    setActionError(undefined);
    try {
      await fn();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell section="cases" crumbs={[ref]}>
      <Page>
        <Header
          title={`Case ${ref}`}
          subtitle={
            <>
              {caseKindLabel(k.kind)}
              {k.account_id ? (
                <>
                  {" · "}
                  <Link to={`/merchants/${k.account_id}`}>{merchant ?? k.account_id}</Link>
                </>
              ) : null}
            </>
          }
          status={
            <span className="np-row">
              <StatusBadge tone={CASE_STATUS_TONE[k.status as keyof typeof CASE_STATUS_TONE] ?? "neutral"}>
                {caseStatusLabel(k.status)}
              </StatusBadge>
              <StatusBadge tone={SEVERITY_TONE[k.severity as keyof typeof SEVERITY_TONE] ?? "neutral"}>
                {`${severityLabel(k.severity)} priority`}
              </StatusBadge>
              {k.livemode ? null : <StatusBadge tone="warning">Test</StatusBadge>}
            </span>
          }
        />
        <div className="c-two-col">
          <div className="np-stack np-stack--lg">
            <Section title="Details">
              <KeyValueList
                items={[
                  {
                    label: "Subject",
                    value: subject ? (
                      <Link to={subject}>{`${k.subject.type} · ${k.subject.id}`}</Link>
                    ) : (
                      `${k.subject.type} · ${k.subject.id}`
                    ),
                  },
                  { label: "Case id", value: <IdText value={k.id} label="case id" /> },
                  { label: "Opened", value: formatDateTime(k.created) },
                  { label: "Assignee", value: k.assignee ? (k.assignee === me ? "You" : k.assignee) : "Unassigned" },
                  {
                    label: "Merchant sees",
                    value: k.review ? "A review on the payment (review.opened sent)" : "Nothing (internal case)",
                  },
                  ...(closed
                    ? [
                        { label: "Resolution", value: caseResolutionLabel(k.resolution) },
                        { label: "Closed", value: k.closed_at ? formatDateTime(k.closed_at) : "—" },
                      ]
                    : []),
                ]}
              />
            </Section>
            <Section title="Timeline">
              {k.events?.length ? (
                <Timeline
                  label="Case timeline"
                  items={[...k.events].reverse().map((e, i) => ({
                    id: `${e.at}-${i}`,
                    time: formatTimeSeconds(e.at),
                    dateTime: isoOf(e.at),
                    title: `${caseActionLabel(e.action)} · ${e.actor === me ? "You" : e.actor}`,
                    body: `${formatDateTime(e.at)}${e.note ? ` — ${e.note}` : ""}`,
                    state: e.action === "closed" ? "done" : e.action === "opened" ? "attention" : "info",
                  }))}
                />
              ) : (
                <p className="np-text-secondary">No activity yet.</p>
              )}
            </Section>
            {closed ? null : (
              <Section title="Add a note">
                <form
                  className="np-stack"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!note.trim()) {
                      setNoteError("Write a note first.");
                      return;
                    }
                    setNoteError(null);
                    void run("note", async () => {
                      const r = await app.api.call(commentOpsCase, {
                        params: { id: k.id },
                        body: { note: note.trim() },
                      });
                      c.set(r);
                      setNote("");
                      toast.show({ tone: "success", title: "Note added" });
                    });
                  }}
                >
                  <Field
                    label="Note"
                    hint="Visible to operators only; encrypted at rest and audited."
                    error={noteError ?? undefined}
                  >
                    <Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  <div>
                    <Button
                      type="submit"
                      variant="secondary"
                      loading={busy === "note"}
                      disabled={Boolean(writeBlocked)}
                    >
                      Add note
                    </Button>
                  </div>
                </form>
              </Section>
            )}
          </div>

          <Card as="aside" aria-labelledby={`${gateId}-a`} className="c-side-card">
            <div className="np-stack">
              <CardTitle>
                <span id={`${gateId}-a`}>Work this case</span>
              </CardTitle>
              {closed ? (
                <Callout tone="neutral" title={`Closed · ${caseResolutionLabel(k.resolution)}`}>
                  Closed cases are read-only.
                </Callout>
              ) : (
                <>
                  {k.assignee === me ? (
                    <Button
                      variant="secondary"
                      fullWidth
                      loading={busy === "assign"}
                      disabled={Boolean(writeBlocked)}
                      onClick={() =>
                        run("assign", async () => {
                          c.set(await app.api.call(assignOpsCase, { params: { id: k.id }, body: { assignee: null } }));
                          toast.show({ tone: "info", title: "Case unassigned" });
                        })
                      }
                    >
                      Unassign me
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      fullWidth
                      loading={busy === "assign"}
                      disabled={Boolean(writeBlocked) || !me}
                      onClick={() =>
                        run("assign", async () => {
                          c.set(
                            await app.api.call(assignOpsCase, { params: { id: k.id }, body: { assignee: me ?? null } }),
                          );
                          toast.show({ tone: "success", title: "Assigned to you" });
                        })
                      }
                    >
                      {k.assignee ? "Take over this case" : "Assign to me"}
                    </Button>
                  )}
                  <Button
                    fullWidth
                    disabled={Boolean(app.blocked(closeOpsCase))}
                    onClick={() => {
                      setResolution("");
                      setClosing(true);
                    }}
                  >
                    Close case
                  </Button>
                  {writeBlocked ? <GateNote id={`${gateId}-g`}>{writeBlocked}</GateNote> : null}
                  <p className="np-text-caption np-text-secondary">
                    Closing records the decision only. Suspending the merchant or blocking an address are separate
                    actions: {k.account_id ? <Link to={`/merchants/${k.account_id}`}>merchant</Link> : null}
                    {k.account_id ? " · " : null}
                    <Link to="/blocklist">blocklist</Link>.
                  </p>
                </>
              )}
              <ActionError error={actionError} />
            </div>
          </Card>
        </div>

        <ActionDialog
          open={closing}
          onClose={() => setClosing(false)}
          title={`Close case ${ref}`}
          description={
            k.review
              ? "The merchant sees the review as closed (review.closed is sent)."
              : "This case is internal; the merchant is not notified."
          }
          noteLabel="Resolution note"
          noteMax={2000}
          confirmLabel="Close case"
          validate={() => (resolution ? null : "Choose a resolution.")}
          onConfirm={async (n) => {
            const r = await app.api.call(closeOpsCase, {
              params: { id: k.id },
              body: { resolution: resolution as (typeof RESOLUTIONS)[number][0], note: n },
            });
            c.set(r);
            toast.show({ tone: "success", title: "Case closed" });
          }}
        >
          <Field label="Resolution" required>
            <Select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Choose a resolution"
            >
              {RESOLUTIONS.map(([v, l]) => (
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
