/**
 * Operator enrolment (identity §8.1): `/auth/enrol#token=…` → `opsEnrolmentVerify` → hardware
 * passkey registration → signed in. The token is read from the fragment (never sent in a Referer or
 * server log) and removed from the address bar immediately.
 */
import { Button, Callout, Field, Input, ShieldCheckIcon, Skeleton } from "@nearpay-internal/ui";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../app/context";
import { isCode } from "../../lib/errors";
import { registerSecurityKey, verifyEnrolment, webAuthnBrowserError } from "../../lib/passkeys";
import { tokenFromHash } from "../../lib/session";
import { ActionError } from "../../ui/ui";
import { AuthLayout } from "./AuthLayout";

type State =
  | { step: "verifying" }
  | { step: "invalid"; error?: unknown }
  | { step: "ready"; email: string; registrationToken: string; expiresAt: number; platform: boolean };

export function Enrol() {
  const app = useApp();
  const [state, setState] = useState<State>({ step: "verifying" });
  const [keyName, setKeyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenFromHash(window.location.hash);
    // strip the token from the address bar and history before anything else
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setState({ step: "invalid" });
      return;
    }
    verifyEnrolment(app.api, token).then(
      (r) =>
        setState({
          step: "ready",
          email: r.email,
          registrationToken: r.registration_token,
          expiresAt: r.expires_at,
          // beta (NP_OPS_ALLOW_PLATFORM_PASSKEYS): identity also accepts Touch ID / phone passkeys
          platform: (r as { platform_passkeys_allowed?: unknown }).platform_passkeys_allowed === true,
        }),
      (e: unknown) => setState({ step: "invalid", error: e }),
    );
  }, [app.api]);

  if (state.step === "verifying")
    return (
      <AuthLayout title="Checking your enrolment link" subtitle="One moment…">
        <div aria-busy="true" className="np-stack np-stack--sm">
          <span className="np-sr-only" role="status">
            Checking your enrolment link…
          </span>
          <Skeleton width="75" />
          <Skeleton shape="block" />
        </div>
      </AuthLayout>
    );

  if (state.step === "invalid") {
    const used = isCode(state.error, "link_used");
    return (
      <AuthLayout title="This enrolment link does not work" subtitle="Enrolment links work once, for 24 hours.">
        <Callout tone="warning" title={used ? "This link was already used" : "The link is expired or incomplete"}>
          {used
            ? "If you enrolled your key already, sign in with it. Otherwise ask an ops admin for a new link."
            : "Ask an ops admin to send you a new enrolment link, then open it in this browser."}
        </Callout>
        {state.error && !isCode(state.error, "link_expired") && !used ? <ActionError error={state.error} /> : null}
        <Button variant="secondary" fullWidth onClick={() => app.navigate("/signin", { replace: true })}>
          Go to sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Register your security key"
      subtitle={
        <>
          Enrolling <strong className="c-strong">{state.email}</strong>. Insert the hardware security key NearPay issued
          to you; you will touch it to confirm.
        </>
      }
    >
      {state.platform ? (
        <Callout tone="warning" title="Beta: platform passkeys accepted">
          During the closed beta the console also accepts this device’s passkey (Touch ID, iCloud Keychain, Google
          Password Manager). You confirm with your fingerprint, face or device PIN. Your operator record shows it as
          “platform passkey — beta”.
        </Callout>
      ) : (
        <Callout tone="info" title="Hardware keys only">
          The console accepts security keys on NearPay’s allow-list. Phone, laptop and synced passkeys are refused.
        </Callout>
      )}
      <form
        className="np-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            const s = await registerSecurityKey(app.api, state.registrationToken, keyName.trim() || undefined);
            app.setSession(s);
            app.navigate("/", { replace: true });
          } catch (err) {
            const msg = webAuthnBrowserError(err);
            if (isCode(err, "link_expired")) setState({ step: "invalid", error: err });
            else setError(msg ? new Error(msg) : err);
            setBusy(false);
          }
        }}
      >
        <Field label="Key name" hint="Optional. Helps you tell keys apart, e.g. “YubiKey 5C — desk”.">
          <Input value={keyName} maxLength={64} onChange={(e) => setKeyName(e.target.value)} autoComplete="off" />
        </Field>
        <Button
          type="submit"
          fullWidth
          loading={busy}
          loadingText={state.platform ? "Confirm on your device…" : "Touch your security key…"}
          leadingIcon={<ShieldCheckIcon size={20} />}
        >
          {state.platform ? "Register passkey" : "Register security key"}
        </Button>
        <ActionError error={error} />
      </form>
    </AuthLayout>
  );
}
