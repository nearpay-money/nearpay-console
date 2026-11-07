/** API errors as the console sees them (error envelope, api-conventions §6) and their friendly copy. */
import { HEADERS } from "@nearpay/spec";

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly param: string | undefined;
  readonly requestId: string | undefined;

  constructor(o: { status: number; type: string; code: string; message: string; param?: string; requestId?: string }) {
    super(o.message);
    this.name = "ApiError";
    this.status = o.status;
    this.type = o.type;
    this.code = o.code;
    this.param = o.param;
    this.requestId = o.requestId;
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const e = (body as { error?: Record<string, unknown> } | undefined)?.error;
    const requestId = res.headers.get(HEADERS.requestId) ?? undefined;
    if (e && typeof e.code === "string" && typeof e.message === "string") {
      return new ApiError({
        status: res.status,
        type: typeof e.type === "string" ? e.type : "api_error",
        code: e.code,
        message: e.message,
        param: typeof e.param === "string" ? e.param : undefined,
        requestId: typeof e.request_id === "string" ? e.request_id : requestId,
      });
    }
    return new ApiError({
      status: res.status,
      type: res.status >= 500 ? "api_error" : "invalid_request_error",
      code: res.status >= 500 ? "api_error" : "http_error",
      message: `The API answered ${res.status}.`,
      requestId,
    });
  }
}

/** Thrown when the operator dismisses the step-up dialog: nothing was sent. */
export class StepUpCanceled extends Error {
  constructor() {
    super("Confirmation canceled.");
    this.name = "StepUpCanceled";
  }
}

export interface FriendlyError {
  /** One sentence for the operator. */
  readonly message: string;
  /** The API's own message when it adds detail (shown under the friendly sentence). */
  readonly detail: string | undefined;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
}

/** Console copy for error codes; the API message is kept as detail. */
const COPY: Readonly<Record<string, string>> = {
  approver_conflict:
    "A different operator must approve. The operator who requested a change cannot approve it — they can only withdraw it.",
  two_person_required: "This action needs a second approver. Request it here; another ops admin approves it.",
  permission_denied: "Your console role cannot do this.",
  state_conflict: "This changed since you opened it. Refresh to see the current state, then try again.",
  authenticator_not_allowed:
    "This key is not on NearPay’s hardware security key allow-list. Use the security key issued to you — phone, laptop and synced passkeys cannot sign in to the console.",
  webauthn_failed:
    "That security key is not registered for the console, or the check did not complete. Try again with your enrolled key.",
  link_expired: "This enrolment link has expired. Ask an ops admin to send a new one.",
  link_used:
    "This enrolment link was already used. Sign in with your security key, or ask an ops admin for a new link.",
  authentication_required: "Your console session has ended. Sign in again with your security key.",
  csrf_token_invalid: "Your console session has ended. Sign in again with your security key.",
  step_up_required: "This action needs a fresh confirmation with your security key.",
  reconciliation_day_open: "That day has not ended yet (UTC). Reconcile only completed days.",
  screening_unavailable: "Screening is unavailable right now. Try again in a minute.",
  address_invalid: "That address is not valid for the selected network.",
  resource_missing: "Not found. It may have been removed, or the link is wrong.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  invalid_response: "The API sent a response the console does not understand. Nothing was changed on this screen.",
  invalid_request: "The request was not accepted. Check the fields and try again.",
  api_error: "NearPay had a problem answering. Try again; if it keeps happening, check the service status.",
  network_error: "Could not reach the NearPay API. Check your connection and try again.",
};

/** Friendly copy + support details for any thrown value. */
export function friendlyError(e: unknown): FriendlyError {
  if (e instanceof StepUpCanceled)
    return { message: e.message, detail: undefined, code: undefined, requestId: undefined };
  if (e instanceof ApiError) {
    const copy = COPY[e.code] ?? (e.status >= 500 ? COPY.api_error : undefined);
    return {
      message: copy ?? e.message,
      detail: copy && e.message && e.message !== copy ? e.message : undefined,
      code: e.code,
      requestId: e.requestId,
    };
  }
  if (e instanceof TypeError)
    return { message: COPY.network_error as string, detail: undefined, code: "network_error", requestId: undefined };
  if (e instanceof Error) return { message: e.message, detail: undefined, code: undefined, requestId: undefined };
  return { message: String(e), detail: undefined, code: undefined, requestId: undefined };
}

export const isCode = (e: unknown, code: string): boolean => e instanceof ApiError && e.code === code;
