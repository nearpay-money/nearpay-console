/** Routing, session guard and global dialogs. */
import { EmptyState, Skeleton, ToastProvider } from "@nearpay-internal/ui";
import { type ReactNode, useEffect } from "react";
import { AuditLog } from "../features/audit/AuditLog";
import { Enrol } from "../features/auth/Enrol";
import { SignIn } from "../features/auth/SignIn";
import { Blocklist } from "../features/blocklist/Blocklist";
import { CaseDetail } from "../features/cases/CaseDetail";
import { CasesList } from "../features/cases/CasesList";
import { ExecutionReview } from "../features/holds/ExecutionReview";
import { HoldsList } from "../features/holds/HoldsList";
import { KybCase } from "../features/kyb/KybCase";
import { KybQueue } from "../features/kyb/KybQueue";
import { MerchantDetail } from "../features/merchants/MerchantDetail";
import { MerchantsList } from "../features/merchants/MerchantsList";
import { Overview } from "../features/overview/Overview";
import { ReconciliationList } from "../features/reconciliation/ReconciliationList";
import { RunDetail } from "../features/reconciliation/RunDetail";
import { RefundDetail } from "../features/refunds/RefundDetail";
import { FindingDetail } from "../features/sentinel/FindingDetail";
import { Sentinel } from "../features/sentinel/Sentinel";
import { matchPath, type RouteSpec } from "../lib/router";
import { AppProvider, Link, useApp } from "./context";
import { SessionExpiryDialog } from "./SessionExpiry";
import { Shell } from "./Shell";
import { StepUpDialog } from "./StepUp";

export const ROUTES: readonly RouteSpec[] = [
  { name: "overview", pattern: "/" },
  { name: "signin", pattern: "/signin" },
  { name: "enrol", pattern: "/auth/enrol" },
  { name: "merchants", pattern: "/merchants" },
  { name: "merchant", pattern: "/merchants/:id" },
  { name: "kyb", pattern: "/kyb" },
  { name: "kybCase", pattern: "/kyb/:id" },
  { name: "cases", pattern: "/cases" },
  { name: "case", pattern: "/cases/:id" },
  { name: "holds", pattern: "/holds" },
  { name: "execution", pattern: "/executions/:id" },
  { name: "refund", pattern: "/refunds/:id" },
  { name: "reconciliation", pattern: "/reconciliation" },
  { name: "run", pattern: "/reconciliation/:id" },
  { name: "sentinel", pattern: "/sentinel" },
  { name: "finding", pattern: "/sentinel/findings/:id" },
  { name: "blocklist", pattern: "/blocklist" },
  { name: "audit", pattern: "/audit" },
];

const TITLES: Readonly<Record<string, string>> = {
  overview: "Operations overview",
  signin: "Sign in",
  enrol: "Enrol your security key",
  merchants: "Merchants",
  merchant: "Merchant",
  kyb: "Business reviews",
  kybCase: "Business review",
  cases: "Cases",
  case: "Case",
  holds: "Payment holds",
  execution: "Review",
  refund: "Refund",
  reconciliation: "Reconciliation",
  run: "Reconciliation run",
  sentinel: "Sentinel",
  finding: "Audit finding",
  blocklist: "Blocklist",
  audit: "Audit log",
};

/** Same-origin `<a>` clicks (kit nav, breadcrumbs, table rows) go through the History API. */
function useLinkInterception() {
  const { navigate } = useApp();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      e.preventDefault();
      navigate(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);
}

function Restoring() {
  return (
    <div className="c-restoring" aria-busy="true">
      <span className="np-sr-only" role="status">
        Loading the console…
      </span>
      <Skeleton shape="title" width="25" />
      <Skeleton shape="block" />
    </div>
  );
}

function NotFound() {
  return (
    <Shell section="overview" crumbs={["Not found"]}>
      <div className="c-page">
        <EmptyState
          title="This page does not exist"
          action={
            <Link to="/" className="np-button np-button--secondary">
              <span>Back to the overview</span>
            </Link>
          }
        >
          Check the address, or start from the operations overview.
        </EmptyState>
      </div>
    </Shell>
  );
}

function Router() {
  const app = useApp();
  useLinkInterception();
  const m = matchPath(ROUTES, app.location.pathname);
  const name = m?.name ?? "notfound";
  const id = m?.params.id ?? "";

  useEffect(() => {
    document.title = `${TITLES[name] ?? "Not found"} · NearPay Operations`;
  }, [name]);

  // signed-in operators never see the auth pages; signed-out ones see only them
  const authPage = name === "signin" || name === "enrol";
  useEffect(() => {
    if (app.restoring) return;
    if (!app.session && !authPage) {
      const here = `${app.location.pathname}${app.location.search}`;
      app.navigate(here === "/" ? "/signin" : `/signin?next=${encodeURIComponent(here)}`, { replace: true });
    } else if (app.session && name === "signin") {
      app.navigate("/", { replace: true });
    }
  }, [app.restoring, app.session, authPage, name, app.location.pathname, app.location.search, app.navigate]);

  if (app.restoring) return <Restoring />;
  if (name === "enrol") return <Enrol />;
  if (!app.session) return name === "signin" ? <SignIn /> : <Restoring />;

  let page: ReactNode;
  switch (name) {
    case "overview":
      page = <Overview />;
      break;
    case "merchants":
      page = <MerchantsList />;
      break;
    case "merchant":
      page = <MerchantDetail id={id} />;
      break;
    case "kyb":
      page = <KybQueue />;
      break;
    case "kybCase":
      page = <KybCase id={id} />;
      break;
    case "cases":
      page = <CasesList />;
      break;
    case "case":
      page = <CaseDetail id={id} />;
      break;
    case "holds":
      page = <HoldsList />;
      break;
    case "execution":
      page = <ExecutionReview id={id} />;
      break;
    case "refund":
      page = <RefundDetail id={id} />;
      break;
    case "reconciliation":
      page = <ReconciliationList />;
      break;
    case "run":
      page = <RunDetail id={id} />;
      break;
    case "sentinel":
      page = <Sentinel />;
      break;
    case "finding":
      page = <FindingDetail id={id} />;
      break;
    case "blocklist":
      page = <Blocklist />;
      break;
    case "audit":
      page = <AuditLog />;
      break;
    default:
      page = <NotFound />;
  }
  // key: remount on navigation so every page starts from its loading state
  return <div key={`${app.location.pathname}${app.location.search}`}>{page}</div>;
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Router />
        <StepUpDialog />
        <SessionExpiryDialog />
      </ToastProvider>
    </AppProvider>
  );
}
