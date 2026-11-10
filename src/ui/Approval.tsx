/**
 * A two-person request (`OpsApproval`): suspension/reinstatement of a merchant or a kill-switch
 * release. The console shows who asked and lets an ops admin approve or reject; whether the
 * approver differs from the requester is decided by the server (`403 approver_conflict`).
 *
 * Adaptive rule: on a single-operator platform (one active ops admin when the request was made) the
 * server adds `single_operator` to the request (an extension, not yet in the spec). The requester may
 * then complete it alone after the wait, confirming again and writing a reason; the console says so
 * and asks for the reason. Without the extension nothing changes.
 */

import type { z } from "@nearpay/spec";
import type { OpsApproval as OpsApprovalSchema } from "@nearpay-internal/spec";
import { Button, Card, CardTitle, KeyValueList, StatusBadge } from "@nearpay-internal/ui";
import { useId, useState } from "react";
import { useApp } from "../app/context";
import { approvalActionLabel, approvalStatusLabel, formatDateTime, formatUntil } from "../lib/format";
import { ROLE_LABEL } from "../lib/permissions";
import { canCompleteAlone, singleOperatorOf } from "../lib/two-person";
import { ActionDialog, GateNote } from "./ui";

export type OpsApproval = z.output<typeof OpsApprovalSchema>;

const STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger", expired: "neutral" } as const;

export function operatorLabel(id: string, role: string | undefined, me: string | undefined): string {
  const r = role && role in ROLE_LABEL ? ROLE_LABEL[role as keyof typeof ROLE_LABEL] : role;
  return `${id === me ? "You" : id}${r ? ` · ${r}` : ""}`;
}

export interface ApprovalCardProps {
  approval: OpsApproval;
  /** What approving does, e.g. "Approve and suspend". */
  approveLabel: string;
  approveBlocked: string | null;
  rejectBlocked: string | null;
  onApprove: (note: string) => Promise<void>;
  onReject: (note: string) => Promise<void>;
  /** Danger styling for destructive approvals (suspension). */
  destructive?: boolean;
}

export function ApprovalCard({
  approval: a,
  approveLabel,
  approveBlocked,
  rejectBlocked,
  onApprove,
  onReject,
  destructive,
}: ApprovalCardProps) {
  const app = useApp();
  const me = app.session?.operator.id;
  const mine = a.requested_by.id === me;
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const gateId = useId();
  const pending = a.status === "pending";
  const solo = singleOperatorOf(a);
  const selfComplete = pending && mine && solo !== null;
  const waiting = selfComplete && !canCompleteAlone(solo, Date.now() / 1000);
  return (
    <Card as="section" aria-labelledby={`${gateId}-t`} className="c-approval">
      <div className="np-stack">
        <div className="c-approval__head">
          <CardTitle as="h3">
            <span id={`${gateId}-t`}>{approvalActionLabel(a.action)} requested</span>
          </CardTitle>
          <StatusBadge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>
            {approvalStatusLabel(a.status)}
          </StatusBadge>
        </div>
        <KeyValueList
          items={[
            { label: "Reason", value: a.reason },
            { label: "Requested by", value: operatorLabel(a.requested_by.id, a.requested_by.role, me) },
            { label: "Requested", value: formatDateTime(a.requested_at) },
            pending
              ? { label: "Expires", value: `${formatDateTime(a.expires_at)} (${formatUntil(a.expires_at)})` }
              : {
                  label: "Decided by",
                  value: a.decided_by ? operatorLabel(a.decided_by.id, a.decided_by.role, me) : "—",
                },
          ]}
        />
        {pending ? (
          <>
            {selfComplete ? (
              <p className="c-two-person c-two-person--solo">
                <strong>You are the only operator.</strong>{" "}
                {waiting && solo.available_at !== null
                  ? `You can complete this yourself from ${formatDateTime(solo.available_at)} (${formatUntil(solo.available_at)}), after confirming again and writing a reason. It is recorded as a single-operator action and alerts the team.`
                  : "You can complete this yourself now: confirm again and write a reason. It is recorded as a single-operator action and alerts the team."}
              </p>
            ) : (
              <p className="c-two-person">
                <strong>A different operator must approve.</strong>{" "}
                {mine
                  ? "You requested this, so another ops admin has to approve it. You can withdraw it."
                  : "Nothing changes until an ops admin other than the requester approves."}
              </p>
            )}
            <div className="np-row">
              <Button
                variant={destructive ? "danger" : "primary"}
                onClick={() => setDialog("approve")}
                disabled={Boolean(approveBlocked) || waiting}
                aria-describedby={approveBlocked ? `${gateId}-a` : undefined}
              >
                {approveLabel}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setDialog("reject")}
                disabled={Boolean(rejectBlocked)}
                aria-describedby={rejectBlocked ? `${gateId}-r` : undefined}
              >
                {mine ? "Withdraw request" : "Reject request"}
              </Button>
            </div>
            {approveBlocked ? <GateNote id={`${gateId}-a`}>{approveBlocked}</GateNote> : null}
            {rejectBlocked && rejectBlocked !== approveBlocked ? (
              <GateNote id={`${gateId}-r`}>{rejectBlocked}</GateNote>
            ) : null}
          </>
        ) : a.decision_note ? (
          <p className="np-text-small np-text-secondary">Decision note: {a.decision_note}</p>
        ) : null}
      </div>
      <ActionDialog
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        title={approveLabel}
        description={
          selfComplete
            ? `Completing executes “${approvalActionLabel(a.action).toLowerCase()}” now, as the only operator. You will confirm again; your reason is recorded in the audit log.`
            : `Approving executes “${approvalActionLabel(a.action).toLowerCase()}” now. A different operator must approve: the requester cannot.`
        }
        noteLabel={selfComplete ? "Reason" : "Approver’s note"}
        noteRequired={selfComplete}
        {...(selfComplete ? { noteMin: solo.reason_min_length } : {})}
        confirmLabel={approveLabel}
        confirmVariant={destructive ? "danger" : "primary"}
        stepUp
        onConfirm={onApprove}
      />
      <ActionDialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        title={mine ? "Withdraw request" : "Reject request"}
        description="Rejecting changes nothing; the request is closed and recorded."
        noteLabel="Why"
        confirmLabel={mine ? "Withdraw request" : "Reject request"}
        onConfirm={onReject}
      />
    </Card>
  );
}
