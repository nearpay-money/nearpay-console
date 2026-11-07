/**
 * Session expiry handling: two minutes before the console session ends (30 min idle / 12 h total,
 * identity §8.1) a dialog offers to stay signed in; at the end the app signs out locally and the
 * sign-in page explains why. Never moves focus unexpectedly: the dialog is modal and announced.
 */
import { Button, Countdown, Modal } from "@nearpay-internal/ui";
import { useState } from "react";
import { ActionError } from "../ui/ui";
import { useApp } from "./context";

export function SessionExpiryDialog() {
  const { expiry, stayActive, signOut } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  if (!expiry) return null;
  const absolute = expiry.reason === "absolute";
  const open = expiry.phase === "warning" && dismissedAt !== expiry.endsAt;
  const stay = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await stayActive();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => (absolute ? setDismissedAt(expiry.endsAt) : void stay())}
      dismissible={false}
      size="sm"
      title="Your console session is ending"
      description={
        absolute
          ? "Console sessions last at most 12 hours. Finish what you are doing; you will sign in again with your security key."
          : "You have been inactive for a while. Stay signed in to keep working."
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out now
          </Button>
          {absolute ? null : (
            <Button loading={busy} onClick={() => void stay()}>
              Stay signed in
            </Button>
          )}
        </>
      }
    >
      <p>
        Signing out in <Countdown deadline={expiry.endsAt * 1000} className="c-strong" />
      </p>
      <ActionError error={error} />
    </Modal>
  );
}
