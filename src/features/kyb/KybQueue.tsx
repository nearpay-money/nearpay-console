/** Business review (KYB) queue — compliance `listOpsKybCases` (default: pending, oldest submission first). */

import type { z } from "@nearpay/spec";
import { listOpsKybCases, type OpsKybCase } from "@nearpay-internal/spec";
import { Pager, SegmentedControl, StatusBadge, Table, type TableColumn } from "@nearpay-internal/ui";
import { useEffect, useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { businessTypeLabel, formatAge, kybRef, kybStatusLabel } from "../../lib/format";
import { useNow, usePaged } from "../../lib/hooks";
import { ErrorState, FilterBar, Header, Page } from "../../ui/ui";
import { KYB_TONE } from "../merchants/MerchantsList";

type Case = z.output<typeof OpsKybCase>;

const STATUSES = [
  { id: "pending", label: "Pending review" },
  { id: "needs_info", label: "Action needed" },
  { id: "approved", label: "Reviewed" },
  { id: "rejected", label: "Rejected" },
];

export function KybQueue() {
  const app = useApp();
  const now = useNow();
  const [status, setStatus] = useState("pending");
  const list = usePaged(
    (cursor) => app.api.call(listOpsKybCases, { query: { status, limit: 20, starting_after: cursor } }),
    (c) => c.account_id,
    [status],
  );
  useEffect(() => {
    for (const c of list.data?.data ?? []) app.rememberMerchant(c.account_id, c.account_display_name);
  }, [list.data, app.rememberMerchant]);

  const columns: TableColumn<Case>[] = [
    { key: "ref", header: "Review", primary: true, cell: (c) => kybRef(c.account_id) },
    {
      key: "merchant",
      header: "Merchant",
      cell: (c) => (
        <span className="c-cell-stack">
          <span>{c.account_display_name}</span>
          <span className="np-text-caption np-text-secondary">
            {c.profile.legal_name ? `${c.profile.legal_name} · self-declared` : "No legal name declared"}
          </span>
        </span>
      ),
    },
    {
      key: "type",
      header: "Business type",
      hideOnNarrow: true,
      cell: (c) => (c.profile.business_type ? businessTypeLabel(c.profile.business_type) : "—"),
    },
    { key: "country", header: "Country", hideOnNarrow: true, cell: (c) => c.profile.country_of_incorporation ?? "—" },
    {
      key: "submitted",
      header: "Submitted",
      numeric: true,
      cell: (c) => (c.submitted_at ? `${formatAge(c.submitted_at, now)} ago` : "Not submitted"),
    },
    {
      key: "status",
      header: "Status",
      cell: (c) => (
        <StatusBadge tone={KYB_TONE[c.status as keyof typeof KYB_TONE] ?? "neutral"}>
          {kybStatusLabel(c.status)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <Shell section="kyb">
      <Page wide>
        <Header
          title="Business reviews"
          subtitle="Merchants’ self-declared business details. Approving enables live mode on details reviewed by NearPay."
        />
        <FilterBar label="Filter business reviews">
          <SegmentedControl label="Status" items={STATUSES} value={status} onChange={setStatus} size="sm" />
        </FilterBar>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            caption="Business reviews"
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(c) => c.account_id}
            rowHref={(c) => app.href(`/kyb/${c.account_id}`)}
            loading={list.loading}
            loadingRows={5}
            empty={
              status === "pending" ? "No business details are waiting for review." : "No reviews with this status."
            }
            footer={
              <Pager
                summary={list.data ? `Page ${list.pageIndex + 1} · ${list.data.data.length} reviews` : undefined}
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
