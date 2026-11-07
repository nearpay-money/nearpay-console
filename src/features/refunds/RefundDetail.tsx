/** Refund view (payments `getOpsRefund`), linked from refund executions. Read-only: the merchant signs refunds. */
import { getOpsRefund } from "@nearpay-internal/spec";
import {
  buttonClassName,
  ExternalLinkIcon,
  formatMoney,
  KeyValueList,
  Stat,
  StatGroup,
  StatusBadge,
  Table,
} from "@nearpay-internal/ui";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { assetDisplay, assetLabel, formatAssetAmount } from "../../lib/assets";
import { formatDateTime, humanize, paymentRef, refundRef, refundStatusLabel } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { DetailSkeleton, ErrorState, Header, IdText, Page, Section } from "../../ui/ui";
import { httpsOnly } from "../holds/ExecutionReview";

const TONE = {
  requires_action: "warning",
  pending: "warning",
  succeeded: "success",
  failed: "danger",
  canceled: "neutral",
} as const;

export function RefundDetail({ id }: { id: string }) {
  const app = useApp();
  const r = useAsync(() => app.api.call(getOpsRefund, { params: { id } }), [id]);
  if (r.loading && !r.data)
    return (
      <Shell section="holds" crumbs={["Refund"]}>
        <DetailSkeleton label="refund" />
      </Shell>
    );
  if (r.error || !r.data)
    return (
      <Shell section="holds" crumbs={["Refund"]}>
        <Page>
          <ErrorState error={r.error} onRetry={r.reload} title="This refund could not be loaded" />
        </Page>
      </Shell>
    );
  const f = r.data;
  const symbol = assetDisplay(f.asset_id)?.symbol;
  const amount = formatMoney({ amount: f.amount, decimals: f.decimals, symbol, minFraction: 2 });
  const explorer = httpsOnly(f.evidence?.explorer_url);
  return (
    <Shell section="holds" crumbs={[refundRef(f.id)]}>
      <Page>
        <Header
          title={`Refund ${refundRef(f.id)}`}
          subtitle={`Payment ${paymentRef(f.payment_intent)} · Created ${formatDateTime(f.created)}`}
          status={
            <span className="np-row">
              <StatusBadge tone={TONE[f.status as keyof typeof TONE] ?? "neutral"}>
                {refundStatusLabel(f.status)}
              </StatusBadge>
              {f.livemode ? null : <StatusBadge tone="warning">Test</StatusBadge>}
            </span>
          }
        />
        <StatGroup className="c-stats">
          <Stat label="Merchant sends" value={amount} sub={assetLabel(f.asset_id)} />
          <Stat
            label="Payer received"
            value={f.amount_received ? formatAssetAmount(f.amount_received, f.recipient.asset_id) : "Not yet"}
            sub={f.amount_received ? "From verified evidence" : "Waiting for evidence"}
          />
          <Stat label="Source" value={humanize(f.source)} sub={f.reason ? humanize(f.reason) : "No reason given"} />
        </StatGroup>
        <div className="c-grid-2">
          <Section title="Returns to">
            <KeyValueList
              items={[
                { label: "Address", value: <code className="c-mono c-break">{f.recipient.address}</code> },
                { label: "Asset", value: assetLabel(f.recipient.asset_id) },
                { label: "Network", value: f.recipient.chain },
                { label: "Address replaced by owner", value: f.recipient.overridden ? "Yes (audited)" : "No" },
              ]}
            />
          </Section>
          <Section title="Evidence">
            {f.evidence ? (
              <div className="np-stack">
                <KeyValueList
                  items={[
                    { label: "Transaction", value: <code className="c-mono c-break">{f.evidence.tx_hash}</code> },
                    { label: "Accepted", value: formatDateTime(f.evidence.observed_at) },
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
              <p className="np-text-secondary">No payer-side evidence yet.</p>
            )}
          </Section>
        </div>
        <Section title="Legs">
          <Table
            caption="Refund legs"
            columns={[
              { key: "n", header: "Leg", primary: true, cell: (l) => `#${l.number}` },
              { key: "status", header: "Status", cell: (l) => humanize(l.status) },
              { key: "amount", header: "Amount", numeric: true, cell: (l) => formatAssetAmount(l.amount, f.asset_id) },
              {
                key: "tx",
                header: "Transaction",
                hideOnNarrow: true,
                cell: (l) => (l.submitted_tx ? <code className="c-mono">{l.submitted_tx.slice(0, 14)}…</code> : "—"),
              },
            ]}
            rows={f.legs}
            rowKey={(l) => String(l.number)}
            empty="No legs prepared yet."
          />
        </Section>
        <p className="np-text-small np-text-secondary">
          Refund id <IdText value={f.id} label="refund id" /> · Refunds require the merchant’s wallet authorization;
          NearPay never moves funds.
        </p>
      </Page>
    </Shell>
  );
}
