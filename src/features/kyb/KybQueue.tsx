/**
 * Businesses list (KYB; formerly the review queue) — compliance `listOpsKybCases`. Open onboarding
 * (ADR-0024): businesses go live automatically, so the list opens on active businesses; operators view
 * them, see screening results, reject for abuse and suspend/reinstate the merchant. `Submitted` only
 * fills up when manual review is turned on (`NP_KYB_MODE=manual`).
 */

import { listOpsKybCases, type OpsKybCase } from "@nearpay-internal/spec";
import { Pager, SegmentedControl, StatusBadge, Table, type TableColumn } from "@nearpay-internal/ui";
import type { z } from "@nearpay-money/spec";
import { useEffect, useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { businessTypeLabel, formatAge, kybRef, kybStatusLabel } from "../../lib/format";
import { useNow, usePaged } from "../../lib/hooks";
import { ErrorState, FilterBar, Header, Page } from "../../ui/ui";
import { KYB_TONE } from "../merchants/MerchantsList";

type Case = z.output<typeof OpsKybCase>;

const STATUSES = [
  { id: "approved", label: "Active" },
  { id: "rejected", label: "Rejected" },
  { id: "pending", label: "Submitted" },
  { id: "needs_info", label: "Action needed" },
];

export function KybQueue() {
  const app = useApp();
  const now = useNow();
  const [status, setStatus] = useState("approved");
  const list = usePaged(
    (cursor) => app.api.call(listOpsKybCases, { query: { status, limit: 20, starting_after: cursor } }),
    (c) => c.account_id,
    [status],
  );
  useEffect(() => {
    for (const c of list.data?.data ?? []) app.rememberMerchant(c.account_id, c.account_display_name);
  }, [list.data, app.rememberMerchant]);

  const columns: TableColumn<Case>[] = [
    { key: "ref", header: "Business", primary: true, cell: (c) => kybRef(c.account_id) },
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
      muted: true,
      header: "Business type",
      hideOnNarrow: true,
      cell: (c) => (c.profile.business_type ? businessTypeLabel(c.profile.business_type) : "—"),
    },
    {
      key: "country",
      muted: true,
      header: "Country",
      hideOnNarrow: true,
      cell: (c) => c.profile.country_of_incorporation ?? "—",
    },
    {
      key: "submitted",
      muted: true,
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
          title="Businesses"
          subtitle="Merchants’ self-declared business details. Complete details go live automatically after geo screening; reject or suspend a business for abuse."
        />
        <FilterBar label="Filter businesses">
          <SegmentedControl label="Status" items={STATUSES} value={status} onChange={setStatus} size="sm" />
        </FilterBar>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            caption="Businesses"
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(c) => c.account_id}
            rowHref={(c) => app.href(`/kyb/${c.account_id}`)}
            loading={list.loading}
            loadingRows={5}
            empty={
              status === "pending"
                ? "Nothing is waiting: businesses go live automatically unless manual review is turned on."
                : "No businesses with this status."
            }
            footer={
              <Pager
                summary={list.data ? `Page ${list.pageIndex + 1} · ${list.data.data.length} businesses` : undefined}
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
