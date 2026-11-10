import type { ReactNode } from "react";
import { OpsLockup } from "../../ui/OpsLockup";

/**
 * Sign-in and enrolment (no shell: the operator is not signed in). Design v2: a navy brand side with
 * the "NearPay Ops" lock-up and the violet accent line, and the form on a white panel. Below 960 px
 * only the panel shows, with the lock-up on top.
 */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="c-auth">
      <aside className="c-auth__side np-surface-navy" aria-label="NearPay Ops">
        <OpsLockup size="lg" />
        <div className="c-auth__pitch">
          <p className="c-auth__pitch-title">Operations console</p>
          <p className="c-auth__pitch-body">
            Held payments, screening, reconciliation and the kill switch. Decisions follow evidence, and NearPay never
            holds funds.
          </p>
        </div>
        <p className="c-auth__side-foot">Payments from any chain, settled on any chain you choose.</p>
      </aside>
      <div className="c-auth__main">
        <main className="c-auth__card" aria-labelledby="auth-title">
          <div className="c-auth__brand">
            <OpsLockup />
          </div>
          <h1 id="auth-title" className="c-auth__title">
            {title}
          </h1>
          <p className="np-text-secondary">{subtitle}</p>
          {children}
        </main>
        <p className="c-auth__foot np-text-caption np-text-secondary">
          Restricted to NearPay operators. Every action is recorded in the audit log.
        </p>
      </div>
    </div>
  );
}
