/**
 * Business review detail (compliance `getOpsKybCase`, `decideOpsKybCase` with step-up). The details
 * are self-declared by the merchant (ADR-0020 d3): no documents, no vendor check. An approval means
 * "Business details reviewed by NearPay" — never a verified identity.
 */
import { decideOpsKybCase, getOpsKybCase } from "@nearpay-internal/spec";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  ExternalLinkIcon,
  Field,
  KeyValueList,
  StatusBadge,
  Timeline,
  useToast,
} from "@nearpay-internal/ui";
import { useEffect, useId, useState } from "react";
import { Link, useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import {
  businessTypeLabel,
  formatDateTime,
  formatTimeSeconds,
  isoOf,
  kybRef,
  kybStatusLabel,
  volumeBandLabel,
} from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { ActionDialog, DetailSkeleton, ErrorState, GateNote, Header, Page, Section, Textarea } from "../../ui/ui";
import { KYB_TONE } from "../merchants/MerchantsList";

type Decision = "approved" | "rejected" | "needs_info";

const DIALOG: Record<Decision, { title: string; confirm: string; description: string; variant: "primary" | "danger" }> =
  {
    approved: {
      title: "Approve business details",
      confirm: "Approve details",
      description:
        "Approving records that NearPay reviewed these self-declared details. Live mode turns on once the merchant also has an active live destination. Checkout shows the legal name as reviewed by NearPay — not as a verified identity.",
      variant: "primary",
    },
    needs_info: {
      title: "Request more information",
      confirm: "Send request",
      description: "The merchant sees your request in the dashboard and by email, and can correct the details.",
      variant: "primary",
    },
    rejected: {
      title: "Reject business details",
      confirm: "Reject details",
      description: "Rejecting keeps live mode off. The merchant is told the review was not approved.",
      variant: "danger",
    },
  };

export function KybCase({ id }: { id: string }) {
  const app = useApp();
  const toast = useToast();
  const c = useAsync(() => app.api.call(getOpsKybCase, { params: { id } }), [id]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [requested, setRequested] = useState("");
  const gateId = useId();

  useEffect(() => {
    if (c.data) app.rememberMerchant(c.data.account_id, c.data.account_display_name);
  }, [c.data, app.rememberMerchant]);

  if (c.loading && !c.data)
    return (
      <Shell section="kyb" crumbs={["Review"]}>
        <DetailSkeleton label="business review" />
      </Shell>
    );
  if (c.error || !c.data)
    return (
      <Shell section="kyb" crumbs={["Review"]}>
        <Page>
          <ErrorState error={c.error} onRetry={c.reload} title="This business review could not be loaded" />
        </Page>
      </Shell>
    );

  const k = c.data;
  const p = k.profile;
  const blocked = app.blocked(decideOpsKybCase);
  const addr = p.business_address;

  return (
    <Shell section="kyb" crumbs={[kybRef(k.account_id)]}>
      <Page>
        <Header
          title={`Business review ${kybRef(k.account_id)}`}
          subtitle={
            <>
              <Link to={`/merchants/${k.account_id}`}>{k.account_display_name}</Link>
              {k.submitted_at ? ` · Submitted ${formatDateTime(k.submitted_at)}` : " · Not submitted yet"}
            </>
          }
          status={
            <StatusBadge tone={KYB_TONE[k.status as keyof typeof KYB_TONE] ?? "neutral"}>
              {kybStatusLabel(k.status)}
            </StatusBadge>
          }
        />
        <div className="c-two-col">
          <div className="np-stack np-stack--lg">
            <Section
              title="Business details"
              actions={<StatusBadge tone="neutral">Self-declared</StatusBadge>}
              description="Declared by the merchant’s owner. No documents were collected and no third party checked them."
            >
              <KeyValueList
                items={[
                  { label: "Legal name", value: p.legal_name ?? "—" },
                  { label: "Country of incorporation", value: p.country_of_incorporation ?? "—" },
                  { label: "Registration number", value: p.registration_number ?? "—" },
                  { label: "Business type", value: p.business_type ? businessTypeLabel(p.business_type) : "—" },
                  {
                    label: "Website",
                    value: p.website ? (
                      <a href={p.website} target="_blank" rel="noopener noreferrer" className="c-external">
                        {p.website}
                        <ExternalLinkIcon size={14} />
                        <span className="np-sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      "None declared"
                    ),
                  },
                  {
                    label: "Business address",
                    value: addr ? (
                      <span className="c-cell-stack">
                        <span>{addr.line1}</span>
                        {addr.line2 ? <span>{addr.line2}</span> : null}
                        <span>{[addr.postal_code, addr.city, addr.region].filter(Boolean).join(" ")}</span>
                        <span>{addr.country}</span>
                      </span>
                    ) : (
                      "—"
                    ),
                  },
                  {
                    label: "Representative",
                    value: p.representative ? `${p.representative.name} · ${p.representative.title}` : "—",
                  },
                  {
                    label: "Expected volume",
                    value: p.expected_monthly_volume ? volumeBandLabel(p.expected_monthly_volume) : "—",
                  },
                ]}
              />
            </Section>
            {k.requested_info ? (
              <Callout tone="warning" title="Information requested from the merchant">
                {k.requested_info}
              </Callout>
            ) : null}
            <Section title="History">
              {k.history.length ? (
                <Timeline
                  label="Review history"
                  items={[...k.history].reverse().map((h, i) => ({
                    id: `${h.at}-${i}`,
                    time: formatTimeSeconds(h.at),
                    dateTime: isoOf(h.at),
                    title: `${kybStatusLabel(h.status)} · ${h.actor}`,
                    body: `${formatDateTime(h.at)}${h.reason ? ` — ${h.reason}` : ""}`,
                    state: h.status === "rejected" ? "attention" : h.status === "pending" ? "pending" : "done",
                  }))}
                />
              ) : (
                <p className="np-text-secondary">No history yet.</p>
              )}
            </Section>
          </div>

          <Card as="aside" aria-labelledby={`${gateId}-d`} className="c-side-card">
            <div className="np-stack">
              <CardTitle>
                <span id={`${gateId}-d`}>Decision</span>
              </CardTitle>
              <p className="np-text-secondary">
                Review the self-declared details against what you can check (public register, website). Your decision
                and reason are audited.
              </p>
              <Button
                fullWidth
                onClick={() => setDecision("approved")}
                disabled={Boolean(blocked) || k.status !== "pending"}
                aria-describedby={`${gateId}-n`}
              >
                Approve details
              </Button>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setRequested("");
                  setDecision("needs_info");
                }}
                disabled={Boolean(blocked)}
              >
                Request more info
              </Button>
              <Button variant="secondary" fullWidth onClick={() => setDecision("rejected")} disabled={Boolean(blocked)}>
                Reject
              </Button>
              <GateNote id={`${gateId}-n`}>
                {blocked ??
                  (k.status !== "pending" ? "Only pending reviews can be approved." : "Needs your security key.")}
              </GateNote>
              {k.decided_at ? (
                <KeyValueList
                  layout="stacked"
                  items={[
                    { label: "Last decision", value: `${formatDateTime(k.decided_at)} · ${k.decided_by ?? "—"}` },
                    { label: "Internal reason", value: k.decision_reason ?? "—" },
                  ]}
                />
              ) : null}
            </div>
          </Card>
        </div>

        {decision ? (
          <ActionDialog
            open
            onClose={() => setDecision(null)}
            title={DIALOG[decision].title}
            description={DIALOG[decision].description}
            noteLabel="Internal reason"
            noteHint="Audited; never shown to the merchant."
            confirmLabel={DIALOG[decision].confirm}
            confirmVariant={DIALOG[decision].variant}
            stepUp
            validate={() =>
              decision === "needs_info" && !requested.trim() ? "Say what the merchant must add or correct." : null
            }
            onConfirm={async (reason) => {
              const r = await app.api.call(decideOpsKybCase, {
                params: { id: k.account_id },
                body: {
                  decision,
                  reason,
                  ...(decision === "needs_info" ? { requested_info: requested.trim() } : {}),
                },
              });
              c.set(r);
              toast.show({
                tone: "success",
                title:
                  decision === "approved"
                    ? "Business details approved"
                    : decision === "needs_info"
                      ? "More information requested"
                      : "Business details rejected",
              });
            }}
          >
            {decision === "needs_info" ? (
              <Field label="What the merchant must add or correct" hint="Shown to the merchant and emailed." required>
                <Textarea value={requested} maxLength={1000} onChange={(e) => setRequested(e.target.value)} />
              </Field>
            ) : null}
          </ActionDialog>
        ) : null}
      </Page>
    </Shell>
  );
}
