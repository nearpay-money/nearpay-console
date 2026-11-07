import { NearPayLogo } from "@nearpay-internal/ui";
import type { ReactNode } from "react";

/** Centered card for sign-in and enrolment (no shell: the operator is not signed in). */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="c-auth">
      <main className="c-auth__card" aria-labelledby="auth-title">
        <div className="c-auth__brand">
          <NearPayLogo />
          <span className="c-auth__workspace">Operations · Internal workspace</span>
        </div>
        <h1 id="auth-title" className="np-text-h3">
          {title}
        </h1>
        <p className="np-text-secondary">{subtitle}</p>
        {children}
      </main>
      <p className="c-auth__foot np-text-caption np-text-secondary">
        Restricted to NearPay operators. Every action is recorded in the audit log.
      </p>
    </div>
  );
}
