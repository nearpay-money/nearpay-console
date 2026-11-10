/**
 * Audit log — one trail (identity `listOpsAuditEvents`): merchant actions, identity's own operator
 * entries and the operator actions compliance, sentinel, payments and rails publish
 * (`ops_action.recorded`). Newest first.
 */

import type { AuditEvent, z } from "@nearpay/spec";
import { listOpsAuditEvents } from "@nearpay-internal/spec";
import { Field, Input, Pager, Select, Table, type TableColumn } from "@nearpay-internal/ui";
import { useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { actorTypeLabel, formatDateTime } from "../../lib/format";
import { usePaged } from "../../lib/hooks";
import { ErrorState, FilterBar, Header, Page } from "../../ui/ui";

type Event = z.output<typeof AuditEvent>;

function targetHref(type: string, id: string): string | null {
  if (id.startsWith("acct_")) return `/merchants/${id}`;
  if (id.startsWith("case_")) return `/cases/${id}`;
  if (id.startsWith("ex_")) return `/executions/${id}`;
  if (id.startsWith("rcn_")) return `/reconciliation/${id}`;
  if (id.startsWith("fnd_")) return `/sentinel/findings/${id}`;
  if (id.startsWith("re_")) return `/refunds/${id}`;
  if (type === "kyb_case" && id.startsWith("acct_")) return `/kyb/${id}`;
  return null;
}

export function AuditLog() {
  const app = useApp();
  const [account, setAccount] = useState(new URLSearchParams(app.location.search).get("account") ?? "");
  const [actorType, setActorType] = useState("");
  const [draft, setDraft] = useState({ action: "", actor: "", target: "", account });
  const [applied, setApplied] = useState({ action: "", actor: "", target: "" });
  const me = app.session?.operator.id;

  const list = usePaged(
    (cursor) =>
      app.api.call(listOpsAuditEvents, {
        query: {
          limit: 25,
          starting_after: cursor,
          account: account || undefined,
          actor_type: actorType || undefined,
          action: applied.action || undefined,
          actor: applied.actor || undefined,
          target: applied.target || undefined,
        },
      }),
    (e) => e.id,
    [account, actorType, applied],
  );

  const columns: TableColumn<Event>[] = [
    { key: "when", muted: true, header: "When", numeric: true, cell: (e) => formatDateTime(e.created) },
    {
      key: "actor",
      muted: true,
      header: "Actor",
      cell: (e) => (
        <span className="c-cell-stack">
          <span>{e.actor.id === me ? "You" : e.actor.id}</span>
          <span className="np-text-caption np-text-secondary">{actorTypeLabel(e.actor.type)}</span>
        </span>
      ),
    },
    { key: "action", header: "Action", primary: true, cell: (e) => <code className="c-mono">{e.action}</code> },
    {
      key: "target",
      header: "Target",
      cell: (e) => {
        if (!e.target) return "—";
        const href = targetHref(e.target.type, e.target.id);
        const text = `${e.target.type} · ${e.target.id}`;
        return href ? (
          <a href={app.href(href)} className="c-break">
            {text}
          </a>
        ) : (
          <span className="c-break">{text}</span>
        );
      },
    },
    {
      key: "merchant",
      header: "Merchant",
      hideOnNarrow: true,
      cell: (e) => (e.account ? (app.merchantName(e.account) ?? "…") : "Platform"),
    },
    {
      key: "details",
      header: "Details",
      hideOnNarrow: true,
      cell: (e) =>
        Object.keys(e.details).length ? (
          <details className="c-details">
            <summary>View</summary>
            <pre className="c-pre">{JSON.stringify(e.details, null, 2)}</pre>
          </details>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <Shell section="audit">
      <Page wide>
        <Header
          title="Audit log"
          subtitle="Every merchant and operator action, in one append-only trail. Newest first."
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAccount(draft.account.trim());
            setApplied({ action: draft.action.trim(), actor: draft.actor.trim(), target: draft.target.trim() });
          }}
        >
          <FilterBar label="Filter the audit log">
            <Field label="Actor type">
              <Select value={actorType} onChange={(e) => setActorType(e.target.value)}>
                <option value="">Anyone</option>
                <option value="operator">Operators</option>
                <option value="user">Merchant users</option>
                <option value="api_key">API keys</option>
                <option value="service">Services</option>
                <option value="system">System</option>
              </Select>
            </Field>
            <Field label="Action">
              <Input
                value={draft.action}
                onChange={(e) => setDraft({ ...draft, action: e.target.value })}
                placeholder="e.g. kyb.decided"
              />
            </Field>
            <Field label="Actor id">
              <Input
                value={draft.actor}
                onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
                placeholder="usr_…, key_…"
              />
            </Field>
            <Field label="Target id">
              <Input
                value={draft.target}
                onChange={(e) => setDraft({ ...draft, target: e.target.value })}
                placeholder="Object id"
              />
            </Field>
            <Field label="Account">
              <Input
                value={draft.account}
                onChange={(e) => setDraft({ ...draft, account: e.target.value })}
                placeholder="acct_…"
              />
            </Field>
            <div className="c-filters__submit">
              <button type="submit" className="np-button np-button--secondary">
                <span>Apply filters</span>
              </button>
            </div>
          </FilterBar>
        </form>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            caption="Audit events"
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(e) => e.id}
            loading={list.loading}
            loadingRows={6}
            empty="No audit events match these filters."
            footer={
              <Pager
                summary={list.data ? `Page ${list.pageIndex + 1} · ${list.data.data.length} events` : undefined}
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
