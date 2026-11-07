/** Console sign-in with an enrolled hardware security key (identity §8.1; `/ops/auth/passkeys/authentication/*`). */
import { Button, Callout, ShieldCheckIcon } from "@nearpay-internal/ui";
import { useState } from "react";
import { useApp } from "../../app/context";
import { signInWithSecurityKey, webAuthnBrowserError } from "../../lib/passkeys";
import { safeNext } from "../../lib/session";
import { ActionError } from "../../ui/ui";
import { AuthLayout } from "./AuthLayout";

export function SignIn() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const next = safeNext(new URLSearchParams(app.location.search).get("next"));
  return (
    <AuthLayout
      title="Sign in to the console"
      subtitle="Use the hardware security key you enrolled. Phone, laptop and synced passkeys are not accepted."
    >
      {app.signedOutReason === "expired" ? (
        <Callout tone="warning" title="Your session ended" live>
          Console sessions end after 30 minutes without activity or 12 hours in total. Sign in again to continue
          {next !== "/" ? " where you left off" : ""}.
        </Callout>
      ) : null}
      {app.signedOutReason === "signed_out" ? (
        <Callout tone="info" title="You are signed out" live>
          Sign in again with your security key when you need the console.
        </Callout>
      ) : null}
      <Button
        fullWidth
        loading={busy}
        loadingText="Touch your security key…"
        leadingIcon={<ShieldCheckIcon size={20} />}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const s = await signInWithSecurityKey(app.api);
            app.setSession(s);
            app.navigate(app.href(next), { replace: true });
          } catch (e) {
            const msg = webAuthnBrowserError(e);
            setError(msg ? new Error(msg) : e);
            setBusy(false);
          }
        }}
      >
        Sign in with security key
      </Button>
      <ActionError error={error} />
      <p className="np-text-small np-text-secondary">
        New operator? Open the enrolment link from your email to register your security key. Links are sent by an ops
        admin and work once, for 24 hours.
      </p>
    </AuthLayout>
  );
}
