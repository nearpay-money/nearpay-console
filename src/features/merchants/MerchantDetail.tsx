/**
 * Merchant detail: account facts (identity `getOpsMerchant`) and suspension with the two-person
 * rule (compliance `getOpsMerchantSuspension`, suspension requests approve/reject).
 */
import {
  approveOpsSuspensionRequest,
  createOpsSuspensionRequest,
  getOpsMerchant,
  getOpsMerchantSuspension,
  rejectOpsSuspensionRequest,
} from "@nearpay-internal/spec";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  KeyValueList,
  Stat,
  StatGroup,
  StatusBadge,
  useToast,
} from "@nearpay-internal/ui";
import { useEffect, useId, useState } from "react";
import { Link, useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { formatDate, formatDateTime, kybStatusLabel, merchantStatusLabel } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { ApprovalCard } from "../../ui/Approval";
import { ActionDialog, DetailSkeleton, ErrorState, GateNote, Header, IdText, Page, Section } from "../../ui/ui";
import { KYB_TONE, MERCHANT_TONE } from "./MerchantsList";

export function MerchantDetail({ id }: { id: string }) {
  const app = useApp();
  const toast = useToast();
  const merchant = useAsync(() => app.api.call(getOpsMerchant, { params: { id } }), [id]);
  const suspension = useAsync(() => app.api.call(getOpsMerchantSuspension, { params: { id } }), [id]);
  const [requesting, setRequesting] = useState(false);
  const gateId = useId();

  useEffect(() => {
    if (merchant.data) app.rememberMerchant(merchant.data.id, merchant.data.display_name);
  }, [merchant.data, app.rememberMerchant]);

  if (merchant.loading && !merchant.data)
    return (
      <Shell section="merchants" crumbs={["Merchant"]}>
        <DetailSkeleton label="merchant" />
      </Shell>
    );
  if (merchant.error || !merchant.data)
    return (
      <Shell section="merchants" crumbs={["Merchant"]}>
        <Page>
          <ErrorState error={merchant.error} onRetry={merchant.reload} title="This merchant could not be loaded" />
        </Page>
      </Shell>
    );

  const m = merchant.data;
  const s = suspension.data;
  const suspended = s ? s.suspended : m.status === "suspended";
  const action = suspended ? "reinstate" : "suspend";
  const requestBlocked = app.blocked(createOpsSuspensionRequest);

  const reload = () => {
    merchant.reload();
    suspension.reload();
  };

  return (
    <Shell section="merchants" crumbs={[m.display_name]}>
      <Page>
        <Header
          title={m.display_name}
          subtitle={<IdText value={m.id} label="account id" />}
          status={
            <StatusBadge tone={MERCHANT_TONE[m.status as keyof typeof MERCHANT_TONE] ?? "neutral"}>
              {merchantStatusLabel(m.status)}
            </StatusBadge>
          }
        />
        <StatGroup className="c-stats">
          <Stat
            label="Business details"
            value={
              <StatusBadge tone={KYB_TONE[m.kyb_status as keyof typeof KYB_TONE] ?? "neutral"}>
                {kybStatusLabel(m.kyb_status)}
              </StatusBadge>
            }
            sub={
              m.kyb_status === "approved" ? (
                "Business details reviewed by NearPay"
              ) : (
                <Link to={`/kyb/${m.id}`}>Open the business review</Link>
              )
            }
          />
          <Stat
            label="Live mode"
            value={m.live_enabled ? "Enabled" : "Not enabled"}
            sub={`${m.active_live_destinations} active live ${m.active_live_destinations === 1 ? "destination" : "destinations"}`}
          />
          <Stat label="Team" value={String(m.member_count)} sub={m.member_count === 1 ? "member" : "members"} />
        </StatGroup>

        <div className="c-two-col">
          <Section title="Account">
            <KeyValueList
              items={[
                {
                  label: "Legal name",
                  value: m.verified_legal_name ? (
                    <span className="c-cell-stack">
                      <span>{m.verified_legal_name}</span>
                      <span className="np-text-caption np-text-secondary">Self-declared · reviewed by NearPay</span>
                    </span>
                  ) : (
                    "Not reviewed yet"
                  ),
                },
                { label: "Country", value: m.country ?? "—" },
                {
                  label: "Owners",
                  value: m.owners.length ? (
                    <span className="c-cell-stack">
                      {m.owners.map((o) => (
                        <span key={o.id}>{o.email}</span>
                      ))}
                    </span>
                  ) : (
                    "—"
                  ),
                },
                { label: "Fee bearer", value: m.fee_bearer === "payer" ? "Payer pays fees" : "Merchant pays fees" },
                { label: "Created", value: formatDate(m.created) },
                {
                  label: "Last recovery",
                  value: m.recovered_at
                    ? `${formatDateTime(m.recovered_at)} (destination changes blocked for 48 h)`
                    : "Never",
                },
              ]}
            />
            <div className="np-row c-links">
              <Link to={`/cases?account=${m.id}`}>Cases</Link>
              <Link to={`/holds?account=${m.id}`}>Executions</Link>
              <Link to={`/reconciliation?account=${m.id}`}>Reconciliation</Link>
              <Link to={`/audit?account=${m.id}`}>Audit log</Link>
            </div>
          </Section>

          <Card as="aside" aria-labelledby={`${gateId}-st`} className="c-side-card">
            <div className="np-stack">
              <CardTitle>
                <span id={`${gateId}-st`}>Suspension</span>
              </CardTitle>
              {suspension.error ? (
                <ErrorState error={suspension.error} onRetry={suspension.reload} />
              ) : !s ? (
                <p className="np-text-secondary">Loading suspension state…</p>
              ) : (
                <>
                  <p>
                    {s.suspended
                      ? "This account is suspended: live-mode changes and new live payments are blocked."
                      : "This account is not suspended."}
                  </p>
                  {s.updated_at ? (
                    <KeyValueList
                      layout="stacked"
                      items={[
                        { label: "Last change", value: `${formatDateTime(s.updated_at)} · ${s.actor ?? "—"}` },
                        { label: "Reason", value: s.reason ?? "—" },
                      ]}
                    />
                  ) : null}
                  {s.pending_request ? null : (
                    <>
                      <Button
                        variant={suspended ? "secondary" : "danger"}
                        fullWidth
                        onClick={() => setRequesting(true)}
                        disabled={Boolean(requestBlocked)}
                        aria-describedby={requestBlocked ? `${gateId}-g` : `${gateId}-h`}
                      >
                        {suspended ? "Request reinstatement" : "Request suspension"}
                      </Button>
                      {requestBlocked ? (
                        <GateNote id={`${gateId}-g`}>{requestBlocked}</GateNote>
                      ) : (
                        <p id={`${gateId}-h`} className="np-text-caption np-text-secondary">
                          Two-person rule: a different ops admin must approve before anything changes.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>

        {s?.pending_request ? (
          <ApprovalCard
            approval={s.pending_request}
            destructive={s.pending_request.action === "account.suspend"}
            approveLabel={
              s.pending_request.action === "account.suspend" ? "Approve and suspend" : "Approve and reinstate"
            }
            approveBlocked={app.blocked(approveOpsSuspensionRequest)}
            rejectBlocked={app.blocked(rejectOpsSuspensionRequest)}
            onApprove={async (note) => {
              const r = await app.api.call(approveOpsSuspensionRequest, {
                params: { id: m.id, request: s.pending_request?.id ?? "" },
                body: note ? { note } : {},
              });
              suspension.set(r);
              merchant.reload();
              toast.show({ tone: "success", title: r.suspended ? "Account suspended" : "Account reinstated" });
            }}
            onReject={async (note) => {
              await app.api.call(rejectOpsSuspensionRequest, {
                params: { id: m.id, request: s.pending_request?.id ?? "" },
                body: { note },
              });
              reload();
              toast.show({ tone: "info", title: "Request closed", body: "Nothing was changed." });
            }}
          />
        ) : null}

        {m.status === "closed" ? (
          <Callout tone="neutral" title="This account is closed">
            Closed accounts cannot take payments. Records stay for the audit trail.
          </Callout>
        ) : null}

        <ActionDialog
          open={requesting}
          onClose={() => setRequesting(false)}
          title={suspended ? `Request reinstating ${m.display_name}` : `Request suspending ${m.display_name}`}
          description={
            suspended
              ? "Reinstating lifts the suspension. Nothing changes until a different ops admin approves (the request expires in 24 hours)."
              : "Suspending blocks live-mode changes and new live payments; the owners are emailed. Nothing changes until a different ops admin approves (the request expires in 24 hours)."
          }
          noteLabel="Reason"
          noteHint="Internal and audited; security contacts are alerted. Never shown to the merchant."
          confirmLabel={suspended ? "Request reinstatement" : "Request suspension"}
          confirmVariant={suspended ? "primary" : "danger"}
          stepUp
          onConfirm={async (reason) => {
            await app.api.call(createOpsSuspensionRequest, { params: { id: m.id }, body: { action, reason } });
            suspension.reload();
            toast.show({
              tone: "success",
              title: suspended ? "Reinstatement requested" : "Suspension requested",
              body: "A different ops admin must approve it.",
            });
          }}
        />
      </Page>
    </Shell>
  );
}
