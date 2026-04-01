import * as Sentry from "npm:@sentry/deno";

export interface RequestContext {
  functionName: string;
  requestId: string;
  executionId: string | null;
  userId: string | null;
  method: string;
  url: string;
  path: string;
  origin: string | null;
  bodySize: number | null;
  headers: Record<string, string>;
}

let sentryInitialized = false;
let sentryEnabled = false;
let globalHandlersAttached = false;

const asNonEmptyString = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseFloatOrDefault = (value: string | null | undefined, fallback: number): number => {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveExecutionId = (): string | null => {
  const candidates = [
    Deno.env.get("SB_EXECUTION_ID"),
    Deno.env.get("SUPABASE_FUNCTION_EXECUTION_ID"),
    Deno.env.get("DENO_DEPLOYMENT_ID"),
  ];

  for (const candidate of candidates) {
    const value = asNonEmptyString(candidate);
    if (value) return value;
  }

  return null;
};

const getRequestId = (req: Request): string => {
  const fromHeader =
    asNonEmptyString(req.headers.get("x-request-id")) ||
    asNonEmptyString(req.headers.get("sb-request-id")) ||
    asNonEmptyString(req.headers.get("x-correlation-id"));

  return fromHeader ?? crypto.randomUUID();
};

const getBodySize = (req: Request): number | null => {
  const contentLength = asNonEmptyString(req.headers.get("content-length"));
  if (!contentLength) return null;
  const parsed = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const pickHeadersForContext = (req: Request): Record<string, string> => {
  const allowlist = new Set([
    "accept",
    "content-type",
    "content-length",
    "origin",
    "user-agent",
    "x-forwarded-for",
    "cf-connecting-ip",
    "x-real-ip",
    "x-request-id",
    "sb-request-id",
  ]);

  const selected: Record<string, string> = {};
  for (const [key, value] of req.headers.entries()) {
    const lower = key.toLowerCase();
    if (allowlist.has(lower)) {
      selected[lower] = value;
    }
  }

  return selected;
};

const attachScopeContext = (
  scope: Sentry.Scope,
  context?: Partial<RequestContext>,
) => {
  if (!context) return;

  if (context.functionName) scope.setTag("function_name", context.functionName);
  if (context.requestId) scope.setTag("request_id", context.requestId);
  if (context.executionId) scope.setTag("execution_id", context.executionId);

  if (context.userId) {
    scope.setUser({ id: context.userId });
  }

  const requestContext: Record<string, unknown> = {
    method: context.method,
    url: context.url,
    path: context.path,
    origin: context.origin,
    body_size: context.bodySize,
    headers: context.headers,
  };

  scope.setContext("request", requestContext);
};

const ensureGlobalHandlers = () => {
  if (globalHandlersAttached) return;

  globalThis.addEventListener("unhandledrejection", (event) => {
    captureException(event.reason, {
      functionName: "global",
      requestId: "unhandledrejection",
      executionId: resolveExecutionId(),
    });
  });

  globalThis.addEventListener("error", (event) => {
    const candidate = (event as ErrorEvent).error ?? (event as ErrorEvent).message;
    captureException(candidate, {
      functionName: "global",
      requestId: "global-error",
      executionId: resolveExecutionId(),
    });
  });

  globalHandlersAttached = true;
};

export const initSentry = (functionName?: string) => {
  if (sentryInitialized) return;

  const dsn = asNonEmptyString(Deno.env.get("SENTRY_DSN"));
  if (!dsn) {
    sentryInitialized = true;
    sentryEnabled = false;
    return;
  }

  Sentry.init({
    dsn,
    environment:
      asNonEmptyString(Deno.env.get("SENTRY_ENVIRONMENT")) ||
      asNonEmptyString(Deno.env.get("ENVIRONMENT")) ||
      asNonEmptyString(Deno.env.get("ENV")) ||
      "development",
    release:
      asNonEmptyString(Deno.env.get("SENTRY_RELEASE")) ||
      asNonEmptyString(resolveExecutionId()) ||
      undefined,
    tracesSampleRate: parseFloatOrDefault(Deno.env.get("SENTRY_TRACES_SAMPLE_RATE"), 0),
    sendDefaultPii: false,
    initialScope: {
      tags: {
        runtime: "supabase-edge",
        ...(functionName ? { function_name: functionName } : {}),
      },
    },
  });

  sentryInitialized = true;
  sentryEnabled = true;
  ensureGlobalHandlers();
};

export const buildRequestContext = (functionName: string, req: Request): RequestContext => {
  const url = new URL(req.url);

  return {
    functionName,
    requestId: getRequestId(req),
    executionId: resolveExecutionId(),
    userId: null,
    method: req.method,
    url: req.url,
    path: url.pathname,
    origin: req.headers.get("origin"),
    bodySize: getBodySize(req),
    headers: pickHeadersForContext(req),
  };
};

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown error");
  }
};

export const captureException = (
  error: unknown,
  context?: Partial<RequestContext>,
) => {
  initSentry(context?.functionName);
  if (!sentryEnabled) return null;

  return Sentry.withScope((scope) => {
    attachScopeContext(scope, context);
    return Sentry.captureException(normalizeError(error));
  });
};

export const captureMessage = (
  message: string,
  level: Sentry.SeverityLevel = "info",
  context?: Partial<RequestContext>,
) => {
  initSentry(context?.functionName);
  if (!sentryEnabled) return null;

  return Sentry.withScope((scope) => {
    attachScopeContext(scope, context);
    scope.setLevel(level);
    return Sentry.captureMessage(message);
  });
};

export const withSentryRequestScope = async <T>(
  context: RequestContext,
  callback: () => Promise<T> | T,
): Promise<T> => {
  initSentry(context.functionName);
  if (!sentryEnabled) {
    return await callback();
  }

  return await Sentry.withScope(async (scope) => {
    attachScopeContext(scope, context);
    return await callback();
  });
};
