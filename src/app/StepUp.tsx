/**
 * Step-up dialog: shown when a console route answers `401 step_up_required`. After a fresh
 * assertion with the operator's security key (`opsStepUpVerify`, 10 minutes) the API client replays
 * the original request once with the same Idempotency-Key. Cancel → "Confirmation canceled." and
 * nothing is sent.
 */
import { Button, Modal, ShieldCheckIcon } from "@nearpay-internal/ui";
import { useState } from "react";
import { StepUpCanceled } from "../lib/errors";
import { stepUpWithSecurityKey, webAuthnBrowserError } from "../lib/passkeys";
import { ActionError } from "../ui/ui";
import { useApp } from "./context";

export function StepUpDialog() {
  const { stepUp, api, setSession } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const cancel = () => {
    if (busy) return;
    setError(undefined);
    stepUp?.reject(new StepUpCanceled());
  };
  return (
    <Modal
      open={Boolean(stepUp)}
      onClose={cancel}
      dismissible={false}
      size="sm"
      title="Confirm with your security key"
      description="This action is sensitive and recorded in the audit log. Touch your security key to confirm; the confirmation lasts 10 minutes."
      footer={
        <>
          <Button variant="secondary" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            loadingText="Waiting for your key…"
            leadingIcon={<ShieldCheckIcon size={20} />}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                const s = await stepUpWithSecurityKey(api);
                setSession(s);
                setBusy(false);
                stepUp?.resolve();
              } catch (e) {
                const msg = webAuthnBrowserError(e);
                setError(msg ? new Error(msg) : e);
                setBusy(false);
              }
            }}
          >
            Confirm with security key
          </Button>
        </>
      }
    >
      <ActionError error={error} />
    </Modal>
  );
}
