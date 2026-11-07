/**
 * App state: API client, ops session (memory only), working mode, navigation, step-up, session
 * expiry and a small in-memory merchant-name cache. Nothing here touches web storage.
 */

import type { AnyRoute, OpsRole } from "@nearpay/spec";
import { getOpsMerchant, opsLogout } from "@nearpay-internal/spec";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient } from "../lib/api";
import { StepUpCanceled } from "../lib/errors";
import { blockedReason, opsAllows } from "../lib/permissions";
import { hrefFor, type Mode, modeFromSearch } from "../lib/router";
import { type ExpiryPhase, expiryPhase, type OpsSession, restoreSession, sessionEndsAt } from "../lib/session";

export const API_BASE = "/api";

interface Loc {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export type SignedOutReason = "expired" | "signed_out" | null;

export interface Expiry {
  readonly phase: ExpiryPhase;
  readonly endsAt: number;
  readonly reason: "idle" | "absolute";
}

export interface AppState {
  readonly api: ApiClient;
  readonly session: OpsSession | null;
  /** True until `getOpsSession` has answered on load (reload / new tab). */
  readonly restoring: boolean;
  setSession(s: OpsSession): void;
  readonly role: OpsRole | undefined;
  readonly mode: Mode;
  setMode(m: Mode): void;
  readonly location: Loc;
  navigate(to: string, opts?: { replace?: boolean }): void;
  /** In-app href keeping the working mode. */
  href(path: string): string;
  /** null = the operator's role may call the route; otherwise why not. */
  blocked(route: Pick<AnyRoute, "auth" | "opsRoles">): string | null;
  can(route: Pick<AnyRoute, "auth" | "opsRoles">): boolean;
  /** Pending step-up request (rendered by the StepUp dialog). */
  readonly stepUp: { resolve(): void; reject(e: Error): void } | null;
  readonly expiry: Expiry | null;
  /** Keeps the session alive (any authenticated call counts as activity). */
  stayActive(): Promise<void>;
  signOut(): Promise<void>;
  readonly signedOutReason: SignedOutReason;
  /** Display name of a merchant account (loaded on demand, memory only); undefined while unknown. */
  merchantName(id: string | null | undefined): string | undefined;
  rememberMerchant(id: string, name: string): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const readLoc = (): Loc => ({
  pathname: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Loc>(readLoc);
  const [session, setSessionState] = useState<OpsSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [stepUp, setStepUp] = useState<AppState["stepUp"]>(null);
  const [signedOutReason, setSignedOutReason] = useState<SignedOutReason>(null);
  const [lastActivity, setLastActivity] = useState<number | undefined>(undefined);
  const [clock, setClock] = useState(nowSec);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const pendingNames = useRef(new Set<string>());
  const mode = modeFromSearch(location.search);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setLocation(readLoc());
    window.scrollTo?.(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => setLocation(readLoc());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setSession = useCallback((s: OpsSession) => {
    sessionRef.current = s;
    setSessionState(s);
    setSignedOutReason(null);
    setLastActivity(nowSec());
  }, []);

  /** Local sign-out: forget the session (and every cached name) and go to sign-in. */
  const endSession = useCallback(
    (reason: SignedOutReason) => {
      if (!sessionRef.current) return;
      sessionRef.current = null;
      setSessionState(null);
      setNames(new Map());
      setSignedOutReason(reason);
      setStepUp((s) => {
        s?.reject(new StepUpCanceled());
        return null;
      });
      const here = `${window.location.pathname}${window.location.search}`;
      const next = reason === "expired" && here !== "/" ? `?next=${encodeURIComponent(here)}` : "";
      navigate(`/signin${next}`, { replace: true });
    },
    [navigate],
  );

  const api = useMemo(
    () =>
      new ApiClient({
        base: API_BASE,
        csrf: () => sessionRef.current?.csrf_token,
        activity: () => setLastActivity(nowSec()),
        stepUp: () =>
          new Promise<void>((resolve, reject) => {
            setStepUp({
              resolve: () => {
                setStepUp(null);
                resolve();
              },
              reject: (e) => {
                setStepUp(null);
                reject(e);
              },
            });
          }),
        unauthenticated: () => endSession("expired"),
      }),
    [endSession],
  );

  // session recovery on load: the cookie is the credential, the API re-issues the session + CSRF token
  useEffect(() => {
    let live = true;
    restoreSession(api)
      .catch(() => null) // API unreachable: treat as signed out; signing in reports the error
      .then((s) => {
        if (!live) return;
        if (s && !sessionRef.current) setSession(s);
        setRestoring(false);
      });
    return () => {
      live = false;
    };
  }, [api, setSession]);

  // expiry clock (5 s resolution is enough for a 2-minute warning)
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setClock(nowSec()), 5000);
    return () => clearInterval(t);
  }, [session]);

  const expiry: Expiry | null = useMemo(() => {
    if (!session) return null;
    const end = sessionEndsAt(session, lastActivity);
    return { phase: expiryPhase(end.at, Math.max(clock, nowSec())), endsAt: end.at, reason: end.reason };
  }, [session, lastActivity, clock]);

  useEffect(() => {
    if (expiry?.phase === "expired") endSession("expired");
  }, [expiry?.phase, endSession]);

  const merchantName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return undefined;
      const known = names.get(id);
      if (known !== undefined) return known;
      if (sessionRef.current && !pendingNames.current.has(id)) {
        pendingNames.current.add(id);
        api.call(getOpsMerchant, { params: { id } }).then(
          (m) => setNames((prev) => new Map(prev).set(id, m.display_name)),
          () => setNames((prev) => new Map(prev).set(id, id)),
        );
      }
      return undefined;
    },
    [api, names],
  );

  const value: AppState = {
    api,
    session,
    restoring,
    setSession,
    role: session?.role,
    mode,
    setMode: (m) => navigate(hrefFor(`${location.pathname}${location.search}`, m)),
    location,
    navigate,
    href: (p) => hrefFor(p, mode),
    blocked: (r) => blockedReason(r, session?.role),
    can: (r) => opsAllows(r, session?.role),
    stepUp,
    expiry,
    stayActive: async () => {
      const s = await restoreSession(api);
      if (s) setSession(s);
      else endSession("expired");
    },
    signOut: async () => {
      try {
        await api.call(opsLogout, { body: {} });
      } catch {
        // the session may already be gone; sign out locally anyway
      }
      endSession("signed_out");
    },
    signedOutReason,
    merchantName,
    rememberMerchant: (id, name) => {
      if (names.get(id) !== name) setNames((prev) => new Map(prev).set(id, name));
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** In-app link that keeps the mode and uses the History API. */
export function Link({
  to,
  children,
  className,
  ...rest
}: { to: string; children: ReactNode; className?: string } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
>) {
  const app = useApp();
  const href = app.href(to);
  return (
    <a
      {...rest}
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        app.navigate(href);
      }}
    >
      {children}
    </a>
  );
}
