/**
 * Same-origin console API client (lld/dashboard-and-console.md §2). Every call goes to
 * `/api<route path>` on the console host (`ops.<domain>/api` → gateway → owning service) with the
 * `__Host-np_ops` cookie, `X-CSRF-Token` on unsafe methods and an `Idempotency-Key` on idempotent
 * writes. Only routes from `OPS_ROUTES` (`@nearpay-internal/spec`) are accepted.
 *
 * - `401 step_up_required` opens the step-up dialog and replays the request once with the **same**
 *   Idempotency-Key (a double submit cannot act twice); cancel rejects with `StepUpCanceled`.
 * - `401 authentication_required` / `403 csrf_token_invalid` → the session is gone (local sign-out).
 * - Responses are parsed with the route's schema via `safeParseTolerant`: unknown fields and unknown
 *   open-enum values are kept; anything else is an `invalid_response` error, never rendered.
 */

import { OPS_ROUTES } from "@nearpay-internal/spec";
import {
  type AnyRoute,
  API_VERSION,
  buildPath,
  HEADERS,
  type RouteBody,
  type RouteResponse,
  safeParseTolerant,
} from "@nearpay-money/spec";
import { ApiError } from "./errors";

export interface CallInput<R> {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: RouteBody<R>;
}

export interface ApiClientOptions {
  readonly base: string;
  readonly fetch?: typeof fetch;
  readonly csrf: () => string | undefined;
  /** Shows the step-up dialog; resolves after a fresh assertion, rejects when the operator cancels. */
  readonly stepUp?: () => Promise<void>;
  /** The session is gone (expired, revoked, CSRF lost). */
  readonly unauthenticated?: (e: ApiError) => void;
  /** Any authenticated call that succeeded (idle-timer bookkeeping). */
  readonly activity?: () => void;
  readonly uuid?: () => string;
}

const OPS_ROUTE_IDS = new Set(OPS_ROUTES.map((r) => r.id));

/** `key=v`; arrays as `key[]=v`; `created[gte]` keys pass through. Empty values are dropped. */
export function encodeQuery(query: Readonly<Record<string, unknown>> | undefined): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const i of v) sp.append(`${k}[]`, String(i));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const isUnsafe = (r: Pick<AnyRoute, "method">) => r.method !== "GET";

const SESSION_LOST = new Set(["authentication_required", "csrf_token_invalid"]);

function invalidResponse(route: AnyRoute, res: Response): ApiError {
  return new ApiError({
    status: res.status,
    type: "api_error",
    code: "invalid_response",
    message: `The API sent a response the console does not understand (${route.id}).`,
    requestId: res.headers.get(HEADERS.requestId) ?? undefined,
  });
}

function parseResponse<R extends AnyRoute>(route: R, res: Response, text: string): RouteResponse<R> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalidResponse(route, res);
  }
  if (!route.response) return json as RouteResponse<R>;
  const r = safeParseTolerant(route.response, json);
  if (!r.success) throw invalidResponse(route, res);
  return r.data as RouteResponse<R>;
}

export class ApiClient {
  readonly #o: ApiClientOptions;
  constructor(o: ApiClientOptions) {
    this.#o = o;
  }

  async call<R extends AnyRoute>(route: R, input: CallInput<R> = {}): Promise<RouteResponse<R>> {
    const o = this.#o;
    if (route.visibility !== "ops" || !OPS_ROUTE_IDS.has(route.id)) {
      throw new Error(`${route.id} is not a console route (OPS_ROUTES only)`);
    }
    const url = `${o.base}${buildPath(route, input.params ?? {})}${encodeQuery(input.query)}`;
    // one key per logical action: the step-up replay reuses it
    const idempotencyKey = route.idempotent && isUnsafe(route) ? (o.uuid ?? (() => crypto.randomUUID()))() : undefined;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Accept: "application/json", [HEADERS.apiVersion]: API_VERSION };
      let body: string | undefined;
      if (isUnsafe(route)) {
        const csrf = o.csrf();
        if (csrf) headers[HEADERS.csrf] = csrf;
        if (idempotencyKey) headers[HEADERS.idempotencyKey] = idempotencyKey;
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(input.body ?? {});
      }
      const res = await (o.fetch ?? fetch)(url, {
        method: route.method,
        headers,
        body,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.ok) {
        if (!route.auth.includes("anonymous")) o.activity?.();
        if (res.status === 204) return undefined as RouteResponse<R>;
        const text = await res.text();
        if (!text) return undefined as RouteResponse<R>;
        return parseResponse(route, res, text);
      }
      const err = await ApiError.fromResponse(res);
      if (err.code === "step_up_required" && o.stepUp && attempt === 0) {
        await o.stepUp();
        continue;
      }
      if ((res.status === 401 || res.status === 403) && SESSION_LOST.has(err.code)) o.unauthenticated?.(err);
      throw err;
    }
  }
}
