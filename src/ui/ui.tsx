/**
 * Console building blocks on top of `@nearpay-internal/ui`: page layout, section panels, error state
 * with retry (friendly API errors), action dialog, id text with copy, detail skeleton, filter bar.
 * The textarea is the kit's (0.3+), with the console's default height.
 */
import {
  Button,
  Callout,
  CheckIcon,
  CopyIcon,
  cx,
  Field,
  Textarea as KitTextarea,
  LiveRegion,
  Modal,
  PageHeader,
  type PageHeaderProps,
  Skeleton,
  type TextareaProps,
} from "@nearpay-internal/ui";
import { forwardRef, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { friendlyError, StepUpCanceled } from "../lib/errors";

/* ------------------------------------------------------------------------------------------ */

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cx("c-page", wide && "c-page--wide", className)}>{children}</div>;
}

export function Header(props: PageHeaderProps) {
  return <PageHeader {...props} className={cx("c-page-header", props.className)} />;
}

export function Section({
  title,
  actions,
  children,
  id,
  description,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  description?: ReactNode;
}) {
  const auto = useId();
  const hid = id ?? `s${auto}`;
  return (
    <section aria-labelledby={hid} className="c-section">
      <div className="c-section__head">
        <div>
          <h2 id={hid} className="np-text-h4">
            {title}
          </h2>
          {description ? <p className="np-text-small np-text-secondary">{description}</p> : null}
        </div>
        {actions ? <div className="np-row c-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ */

/** Error state of a view: friendly copy, the API detail and request id, and a retry button. */
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const f = friendlyError(error);
  return (
    <div role="alert" className="c-error-state">
      <Callout
        tone="danger"
        title={title ?? "This could not be loaded"}
        reference={f.requestId ? `Request ${f.requestId}${f.code ? ` · ${f.code}` : ""}` : undefined}
      >
        <p>{f.message}</p>
        {f.detail ? <p className="np-text-small">{f.detail}</p> : null}
        {onRetry ? (
          <div className="c-error-state__action">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
      </Callout>
    </div>
  );
}

/** Result of a write, in place (alert for errors, polite status otherwise). */
export function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  const f = friendlyError(error);
  if (error instanceof StepUpCanceled)
    return (
      <p role="status" className="c-action-note">
        {f.message} Nothing was sent.
      </p>
    );
  return (
    <div role="alert">
      <Callout
        tone="danger"
        title={f.message}
        reference={f.requestId ? `Request ${f.requestId}${f.code ? ` · ${f.code}` : ""}` : undefined}
      >
        {f.detail ? <p>{f.detail}</p> : null}
      </Callout>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

export type { TextareaProps };

/** The kit's multi-line field (Field wiring, v2 focus ring), three rows high by default. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ rows = 3, ...rest }, ref) {
  return <KitTextarea ref={ref} rows={rows} {...rest} />;
});

/* ------------------------------------------------------------------------------------------ */

export interface ActionDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Label of the note/reason field; omit for no field. */
  noteLabel?: string;
  noteHint?: ReactNode;
  noteRequired?: boolean;
  noteMax?: number;
  /** Minimum length of the (trimmed) note; implies a required note. */
  noteMin?: number;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  /** Extra fields above the note. */
  children?: ReactNode;
  /** Runs the write; throw to show the error in the dialog. */
  onConfirm: (note: string) => Promise<void>;
  /** "Confirm with your security key" hint under the actions. */
  stepUp?: boolean;
  /** Extra validation of the dialog's own fields; return an error sentence or null. */
  validate?: () => string | null;
}

/** Confirmation dialog with an audited reason/note, busy state, error mapping and step-up hint. */
export function ActionDialog({
  open,
  onClose,
  title,
  description,
  noteLabel,
  noteHint,
  noteRequired = true,
  noteMax = 500,
  noteMin,
  confirmLabel,
  confirmVariant = "primary",
  children,
  onConfirm,
  stepUp,
  validate,
}: ActionDialogProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [invalid, setInvalid] = useState<string | null>(null);
  const formId = useId();
  useEffect(() => {
    if (open) {
      setNote("");
      setError(undefined);
      setInvalid(null);
      setBusy(false);
    }
  }, [open]);
  const submit = async () => {
    const trimmed = note.trim();
    if (noteLabel && (noteRequired || noteMin) && !trimmed) {
      setInvalid(`Add a ${noteLabel.toLowerCase()}. It is recorded in the audit log.`);
      return;
    }
    if (noteLabel && noteMin && trimmed.length < noteMin) {
      setInvalid(`Write at least ${noteMin} characters. It is recorded in the audit log.`);
      return;
    }
    const v = validate?.() ?? null;
    if (v) {
      setInvalid(v);
      return;
    }
    setInvalid(null);
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      description={description}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant={confirmVariant} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="np-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {children}
        {noteLabel ? (
          <Field
            label={noteLabel}
            hint={noteHint ?? "Recorded in the audit log with your operator id."}
            required={noteRequired}
            error={invalid ?? undefined}
          >
            <Textarea value={note} maxLength={noteMax} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : invalid ? (
          <p role="alert" className="c-field-error">
            {invalid}
          </p>
        ) : null}
        {stepUp ? (
          <p className="np-text-caption np-text-secondary">You’ll confirm with your security key if asked.</p>
        ) : null}
        <ActionError error={error} />
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------------------------------ */

/** Monospace id with a small copy button (ids are operator lookup keys). */
export function IdText({ value, label = "id" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <span className="c-id">
      <code className="c-id__value">{value}</code>
      <button
        type="button"
        className="c-id__copy"
        aria-label={`Copy ${label} ${value}`}
        title={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            clearTimeout(t.current);
            t.current = setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
      <LiveRegion>{copied ? `Copied ${label}` : ""}</LiveRegion>
    </span>
  );
}

/* ------------------------------------------------------------------------------------------ */

export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div className="c-page" aria-busy="true">
      <span className="np-sr-only" role="status">
        Loading {label}…
      </span>
      <Skeleton shape="title" width="50" />
      <Skeleton width="75" />
      <div className="c-stats">
        <Skeleton shape="stat" />
        <Skeleton shape="stat" />
        <Skeleton shape="stat" />
      </div>
      <Skeleton shape="block" />
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <div className="c-stats" aria-hidden="true">
      <Skeleton shape="stat" />
      <Skeleton shape="stat" />
      <Skeleton shape="stat" />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

export function FilterBar({ children, label }: { children: ReactNode; label: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a filter toolbar, not a form submission
    <div role="group" aria-label={label} className="c-filters">
      {children}
    </div>
  );
}

/** Why a control is disabled (role gating), tied to it with aria-describedby. */
export function GateNote({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="c-gate-note">
      {children}
    </p>
  );
}
