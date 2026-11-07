/** Merchants: search (`acct_` id, member email, name prefix) and filters (identity `listOpsMerchants`). */

import type { z } from "@nearpay/spec";
import { listOpsMerchants, type OpsMerchant } from "@nearpay-internal/spec";
import { Field, Pager, SearchInput, Select, StatusBadge, Table, type TableColumn } from "@nearpay-internal/ui";
import { useEffect, useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { formatDate, kybStatusLabel, merchantStatusLabel } from "../../lib/format";
import { usePaged } from "../../lib/hooks";
import { ErrorState, FilterBar, Header, Page } from "../../ui/ui";

type Merchant = z.output<typeof OpsMerchant>;

export const MERCHANT_TONE = { active: "success", suspended: "danger", closed: "neutral" } as const;
export const KYB_TONE = {
  approved: "success",
  pending: "warning",
  needs_info: "warning",
  rejected: "danger",
  not_started: "neutral",
} as const;

export function MerchantsList() {
  const app = useApp();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [kyb, setKyb] = useState("");
  const [live, setLive] = useState("");

  // search as you type, debounced; 1 character is not a valid query (min 2)
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim().length >= 2 ? q.trim() : ""), 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = usePaged(
    (cursor) =>
      app.api.call(listOpsMerchants, {
        query: {
          limit: 20,
          starting_after: cursor,
          q: query || undefined,
          status: status || undefined,
          kyb_status: kyb || undefined,
          live_enabled: live || undefined,
        },
      }),
    (m) => m.id,
    [query, status, kyb, live],
  );

  useEffect(() => {
    for (const m of list.data?.data ?? []) app.rememberMerchant(m.id, m.display_name);
  }, [list.data, app.rememberMerchant]);

  const columns: TableColumn<Merchant>[] = [
    {
      key: "name",
      header: "Merchant",
      primary: true,
      cell: (m) => (
        <span className="c-cell-stack">
          <span>{m.display_name}</span>
          <span className="np-text-caption np-text-secondary">{m.verified_legal_name ?? m.id}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (m) => (
        <StatusBadge tone={MERCHANT_TONE[m.status as keyof typeof MERCHANT_TONE] ?? "neutral"}>
          {merchantStatusLabel(m.status)}
        </StatusBadge>
      ),
    },
    {
      key: "kyb",
      header: "Business details",
      cell: (m) => (
        <StatusBadge tone={KYB_TONE[m.kyb_status as keyof typeof KYB_TONE] ?? "neutral"}>
          {kybStatusLabel(m.kyb_status)}
        </StatusBadge>
      ),
    },
    { key: "live", header: "Live mode", hideOnNarrow: true, cell: (m) => (m.live_enabled ? "Enabled" : "Not enabled") },
    { key: "country", header: "Country", hideOnNarrow: true, cell: (m) => m.country ?? "—" },
    { key: "created", header: "Created", numeric: true, hideOnNarrow: true, cell: (m) => formatDate(m.created) },
  ];

  const filtered = Boolean(query || status || kyb || live);

  return (
    <Shell section="merchants">
      <Page wide>
        <Header title="Merchants" subtitle="Find an account, check its status and request suspensions." />
        <FilterBar label="Filter merchants">
          <Field label="Search" hint="Account id, member email or name" className="c-filters__search">
            <SearchInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="acct_…, owner@example.com or name"
            />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="closed">Closed</option>
            </Select>
          </Field>
          <Field label="Business details">
            <Select value={kyb} onChange={(e) => setKyb(e.target.value)}>
              <option value="">Any</option>
              <option value="pending">Pending review</option>
              <option value="needs_info">Action needed</option>
              <option value="approved">Reviewed</option>
              <option value="rejected">Rejected</option>
              <option value="not_started">Not submitted</option>
            </Select>
          </Field>
          <Field label="Live mode">
            <Select value={live} onChange={(e) => setLive(e.target.value)}>
              <option value="">Any</option>
              <option value="true">Enabled</option>
              <option value="false">Not enabled</option>
            </Select>
          </Field>
        </FilterBar>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            caption="Merchants"
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(m) => m.id}
            rowHref={(m) => app.href(`/merchants/${m.id}`)}
            loading={list.loading}
            loadingRows={5}
            empty={filtered ? "No merchants match these filters." : "No merchant accounts yet."}
            footer={
              <Pager
                summary={list.data ? `Page ${list.pageIndex + 1} · ${list.data.data.length} merchants` : undefined}
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
