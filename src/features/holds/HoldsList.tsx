/**
 * Payment holds = the executions explorer (rails `listOpsExecutions`), filtered to `state=held` by
 * default. `livemode` is required: the explorer never mixes modes (INV-8).
 */

import type { z } from "@nearpay/spec";
import { type Execution, listOpsExecutions } from "@nearpay-internal/spec";
import { Field, Pager, SearchInput, Select, StatusBadge, Table, type TableColumn } from "@nearpay-internal/ui";
import { useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { assetLabel, formatAssetAmount } from "../../lib/assets";
import { executionRef, executionStateLabel, formatAge, heldReasonLabel } from "../../lib/format";
import { useNow, usePaged } from "../../lib/hooks";
import { ModeFilter } from "../../ui/ModeFilter";
import { ErrorState, FilterBar, Header, Page } from "../../ui/ui";

type Ex = z.output<typeof Execution>;

export const STATE_TONE: Readonly<Record<string, "success" | "warning" | "danger" | "neutral">> = {
  held: "warning",
  verifying: "warning",
  settling: "warning",
  deposit_detected: "warning",
  incomplete_deposit: "warning",
  awaiting_deposit: "neutral",
  quoting: "neutral",
  succeeded: "success",
  refunded: "neutral",
  failed: "danger",
  expired_unpaid: "neutral",
};

export function HoldsList() {
  const app = useApp();
  const now = useNow();
  const params = new URLSearchParams(app.location.search);
  const [account] = useState(params.get("account") ?? "");
  const [state, setState] = useState(params.get("account") ? "" : "held");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState("");
  const [addrQ, setAddrQ] = useState("");
  const [address, setAddress] = useState("");
  const live = app.mode === "live" ? "true" : "false";

  const list = usePaged(
    (cursor) =>
      app.api.call(listOpsExecutions, {
        query: {
          livemode: live,
          limit: 20,
          starting_after: cursor,
          state: state || undefined,
          held_reason: reason || undefined,
          kind: kind || undefined,
          account: account || undefined,
          deposit_address: address || undefined,
        },
      }),
    (e) => e.id,
    [live, state, reason, kind, account, address],
  );

  const columns: TableColumn<Ex>[] = [
    { key: "ref", header: state === "held" ? "Review" : "Execution", primary: true, cell: (e) => executionRef(e.id) },
    { key: "merchant", header: "Merchant", cell: (e) => app.merchantName(e.account_id) ?? "…" },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      cell: (e) => (
        <span className="c-cell-stack">
          <span>{formatAssetAmount(e.settlement.expected, e.settlement.asset_id)}</span>
          <span className="np-text-caption np-text-secondary">{assetLabel(e.settlement.asset_id)}</span>
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (e) => (e.held_reason ? heldReasonLabel(e.held_reason) : e.kind === "refund" ? "Refund leg" : "Payment"),
    },
    {
      key: "state",
      header: "State",
      cell: (e) => <StatusBadge tone={STATE_TONE[e.state] ?? "neutral"}>{executionStateLabel(e.state)}</StatusBadge>,
    },
    {
      key: "age",
      header: state === "held" ? "Held for" : "Updated",
      numeric: true,
      hideOnNarrow: true,
      cell: (e) => formatAge(e.updated_at, now),
    },
  ];

  return (
    <Shell section="holds">
      <Page wide>
        <Header
          title="Payment holds"
          subtitle="Payments the Verifier held for evidence, and the executions explorer. Only evidence completes a payment."
        />
        <FilterBar label="Filter executions">
          <ModeFilter />
          <Field label="State">
            <Select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="held">Held for review</option>
              <option value="">Any state</option>
              <option value="verifying">Confirming</option>
              <option value="settling">Settling</option>
              <option value="deposit_detected">Payment detected</option>
              <option value="awaiting_deposit">Awaiting deposit</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
              <option value="expired_unpaid">Expired</option>
            </Select>
          </Field>
          <Field label="Held reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Any reason</option>
              <option value="evidence_timeout">Evidence overdue</option>
              <option value="evidence_mismatch">Evidence does not match</option>
              <option value="failed_after_deposit">Failed after deposit</option>
              <option value="unknown_status">Unknown provider status</option>
            </Select>
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Payments and refunds</option>
              <option value="payment">Payments</option>
              <option value="refund">Refunds</option>
            </Select>
          </Field>
          <form
            className="c-filters__search c-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              setAddress(addrQ.trim());
            }}
          >
            <Field label="Deposit address" hint="Exact address (press Enter)">
              <SearchInput value={addrQ} onChange={(e) => setAddrQ(e.target.value)} placeholder="Deposit address" />
            </Field>
          </form>
        </FilterBar>
        {account ? (
          <p className="np-text-small np-text-secondary">
            Showing executions of {app.merchantName(account) ?? account} only.
          </p>
        ) : null}
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            caption={state === "held" ? "Held payments" : "Executions"}
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(e) => e.id}
            rowHref={(e) => app.href(`/executions/${e.id}`)}
            loading={list.loading}
            loadingRows={5}
            empty={
              state === "held"
                ? `No ${app.mode} payments are held. The Verifier holds payments whose evidence is late or does not match.`
                : "No executions match these filters."
            }
            footer={
              <Pager
                summary={list.data ? `Page ${list.pageIndex + 1} · ${list.data.data.length} executions` : undefined}
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
