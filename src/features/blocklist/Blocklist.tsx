/**
 * Blocklist and screening (compliance): list/add/remove entries (`addOpsBlocklistEntry` step-up;
 * `removeOpsBlocklistEntry` ops_admin + step-up), a screening lookup (`createOpsScreening`, v1
 * provider `local`: OFAC digital-currency list + blocklist) and a re-screen of destinations.
 */

import {
  addOpsBlocklistEntry,
  type BlocklistEntry,
  createOpsRescreen,
  createOpsScreening,
  listOpsBlocklist,
  removeOpsBlocklistEntry,
} from "@nearpay-internal/spec";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  Field,
  Input,
  Pager,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  type TableColumn,
  useToast,
} from "@nearpay-internal/ui";
import type { RouteResponse, z } from "@nearpay-money/spec";
import { useId, useState } from "react";
import { useApp } from "../../app/context";
import { Shell } from "../../app/Shell";
import { formatDateTime } from "../../lib/format";
import { usePaged } from "../../lib/hooks";
import { ActionDialog, ActionError, ErrorState, FilterBar, GateNote, Header, Page, Section } from "../../ui/ui";

type Entry = z.output<typeof BlocklistEntry>;
type Screening = RouteResponse<typeof createOpsScreening>;

export const CHAINS = [
  ["", "Every network the address fits"],
  ["near:mainnet", "NEAR"],
  ["eip155:1", "Ethereum"],
  ["eip155:8453", "Base"],
  ["eip155:42161", "Arbitrum"],
  ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "Solana"],
] as const;

const chainLabel = (c: string | null) => (c ? (CHAINS.find(([v]) => v === c)?.[1] ?? c) : "Every network");

export function Blocklist() {
  const app = useApp();
  const toast = useToast();
  const [type, setType] = useState("");
  const [subjectQ, setSubjectQ] = useState("");
  const [subject, setSubject] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [form, setForm] = useState({ subject_type: "address", chain: "", subject: "" });
  const gateId = useId();

  const list = usePaged(
    (cursor) =>
      app.api.call(listOpsBlocklist, {
        query: { limit: 20, starting_after: cursor, subject_type: type || undefined, subject: subject || undefined },
      }),
    (e) => e.id,
    [type, subject],
  );

  const addBlocked = app.blocked(addOpsBlocklistEntry);
  const removeBlocked = app.blocked(removeOpsBlocklistEntry);

  const columns: TableColumn<Entry>[] = [
    {
      key: "subject",
      header: "Subject",
      primary: true,
      cell: (e) => (
        <span className="c-cell-stack">
          <code className="c-mono">{e.subject}</code>
          <span className="np-text-caption np-text-secondary">
            {e.subject_type === "near_account" ? "NEAR account" : "Address"} · {chainLabel(e.chain)}
          </span>
        </span>
      ),
    },
    { key: "reason", header: "Reason", cell: (e) => e.reason },
    {
      key: "by",
      muted: true,
      header: "Added by",
      hideOnNarrow: true,
      cell: (e) => (e.created_by === app.session?.operator.id ? "You" : e.created_by),
    },
    {
      key: "created",
      muted: true,
      header: "Added",
      numeric: true,
      hideOnNarrow: true,
      cell: (e) => formatDateTime(e.created),
    },
    {
      key: "actions",
      header: <span className="np-sr-only">Actions</span>,
      align: "end",
      cell: (e) => (
        <Button
          variant="quiet"
          size="sm"
          className="c-quiet-danger"
          onClick={() => setRemoving(e)}
          disabled={Boolean(removeBlocked)}
          aria-describedby={removeBlocked ? `${gateId}-rm` : undefined}
          aria-label={`Remove ${e.subject} from the blocklist`}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <Shell section="blocklist">
      <Page wide>
        <Header
          title="Blocklist"
          subtitle="Addresses and NEAR accounts NearPay refuses, screened like sanctions hits."
          actions={
            <Button onClick={() => setAdding(true)} disabled={Boolean(addBlocked)}>
              Block an address
            </Button>
          }
        />
        {removeBlocked ? <GateNote id={`${gateId}-rm`}>Removing entries: {removeBlocked}</GateNote> : null}
        <FilterBar label="Filter the blocklist">
          <Field label="Subject type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Any</option>
              <option value="address">Address</option>
              <option value="near_account">NEAR account</option>
            </Select>
          </Field>
          <form
            className="c-filters__search c-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSubject(subjectQ.trim());
            }}
          >
            <Field label="Find a subject" hint="Exact address or account (press Enter)">
              <SearchInput
                value={subjectQ}
                onChange={(e) => setSubjectQ(e.target.value)}
                placeholder="0x… or name.near"
              />
            </Field>
          </form>
        </FilterBar>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            caption="Blocklist entries"
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(e) => e.id}
            loading={list.loading}
            loadingRows={4}
            empty={subject || type ? "No entries match." : "The blocklist is empty."}
            footer={
              <Pager
                summary={list.data ? `Page ${list.pageIndex + 1} · ${list.data.data.length} entries` : undefined}
                hasPrevious={list.hasPrevious}
                hasNext={list.hasNext}
                onPrevious={list.previous}
                onNext={list.next}
              />
            }
          />
        )}
        <div className="c-grid-2">
          <ScreeningLookup />
          <Rescreen />
        </div>

        <ActionDialog
          open={adding}
          onClose={() => setAdding(false)}
          title="Block an address"
          description="New screenings refuse it at once; monitored destinations that match are re-screened and disabled."
          noteLabel="Reason"
          noteHint="Internal and audited."
          confirmLabel="Block address"
          confirmVariant="danger"
          stepUp
          validate={() => (form.subject.trim() ? null : "Enter the address or NEAR account to block.")}
          onConfirm={async (reason) => {
            await app.api.call(addOpsBlocklistEntry, {
              body: {
                subject_type: form.subject_type as "address" | "near_account",
                subject: form.subject.trim(),
                ...(form.chain ? { chain: form.chain } : {}),
                reason,
              },
            });
            setForm({ subject_type: "address", chain: "", subject: "" });
            list.reload();
            toast.show({ tone: "success", title: "Address blocked" });
          }}
        >
          <Field label="Type" required>
            <Select value={form.subject_type} onChange={(e) => setForm({ ...form, subject_type: e.target.value })}>
              <option value="address">Address</option>
              <option value="near_account">NEAR account</option>
            </Select>
          </Field>
          {form.subject_type === "address" ? (
            <Field label="Network" hint="Leave as is to match every network the address form fits.">
              <Select value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })}>
                {CHAINS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={form.subject_type === "address" ? "Address" : "NEAR account"} required>
            <Input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              autoComplete="off"
              spellCheck={false}
              className="c-mono-input"
            />
          </Field>
        </ActionDialog>

        <ActionDialog
          open={Boolean(removing)}
          onClose={() => setRemoving(null)}
          title="Remove from the blocklist"
          description={
            removing
              ? `${removing.subject} is screened normally again for new screenings. Destinations already disabled by a hit stay disabled; sanctions-list entries cannot be removed here.`
              : undefined
          }
          noteLabel="Reason"
          confirmLabel="Remove entry"
          confirmVariant="danger"
          stepUp
          onConfirm={async (reason) => {
            if (!removing) return;
            await app.api.call(removeOpsBlocklistEntry, { params: { id: removing.id }, body: { reason } });
            list.reload();
            toast.show({ tone: "success", title: "Entry removed" });
          }}
        />
      </Page>
    </Shell>
  );
}

function ScreeningLookup() {
  const app = useApp();
  const [form, setForm] = useState({ subject_type: "address", chain: "", subject: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Screening | null>(null);
  const [error, setError] = useState<unknown>();
  const blocked = app.blocked(createOpsScreening);
  const id = useId();
  return (
    <Card as="section" aria-labelledby={`${id}-t`}>
      <form
        className="np-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.subject.trim()) return;
          setBusy(true);
          setError(undefined);
          setResult(null);
          try {
            setResult(
              await app.api.call(createOpsScreening, {
                body: {
                  subject_type: form.subject_type as "address" | "near_account",
                  subject: form.subject.trim(),
                  ...(form.chain ? { chain: form.chain } : {}),
                  livemode: app.mode === "live",
                },
              }),
            );
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <CardTitle>
          <span id={`${id}-t`}>Screen an address</span>
        </CardTitle>
        <p className="np-text-small np-text-secondary">
          Runs the screening now, without the cache ({app.mode === "live" ? "live" : "test"} mode): the OFAC
          digital-currency list and the NearPay blocklist.
        </p>
        <Field label="Type">
          <Select value={form.subject_type} onChange={(e) => setForm({ ...form, subject_type: e.target.value })}>
            <option value="address">Address</option>
            <option value="near_account">NEAR account</option>
          </Select>
        </Field>
        <Field label={form.subject_type === "address" ? "Address" : "NEAR account"} required>
          <Input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            autoComplete="off"
            spellCheck={false}
            className="c-mono-input"
          />
        </Field>
        <div>
          <Button type="submit" variant="secondary" loading={busy} disabled={Boolean(blocked)}>
            Screen now
          </Button>
        </div>
        {result ? (
          <Callout
            tone={result.decision === "allow" ? "success" : result.decision === "block" ? "danger" : "warning"}
            title={
              result.decision === "allow"
                ? "No hit"
                : result.decision === "block"
                  ? "Blocked"
                  : `Decision: ${result.decision}`
            }
            reference={`Screening ${result.screening_id}${result.provider ? ` · provider ${result.provider}` : ""}`}
            live
          >
            {result.reasons.length ? `Reasons: ${result.reasons.join(", ")}` : "No list matched."}
          </Callout>
        ) : null}
        <ActionError error={error} />
      </form>
    </Card>
  );
}

function Rescreen() {
  const app = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const blocked = app.blocked(createOpsRescreen);
  const id = useId();
  return (
    <Section title="Re-screen destinations" id={`${id}-rs`}>
      <p className="np-text-small np-text-secondary">
        Queues the same job as the daily re-screen for every active settlement destination. Hits disable the destination
        and open a case.
      </p>
      <div>
        <StatusBadge tone="neutral">Daily job runs automatically</StatusBadge>
      </div>
      <div>
        <Button
          variant="secondary"
          loading={busy}
          disabled={Boolean(blocked)}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              const r = await app.api.call(createOpsRescreen, { body: {} });
              toast.show({
                tone: "success",
                title: "Re-screen queued",
                body: `${r.destinations} destinations queued.`,
              });
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Re-screen all destinations
        </Button>
      </div>
      <ActionError error={error} />
    </Section>
  );
}
