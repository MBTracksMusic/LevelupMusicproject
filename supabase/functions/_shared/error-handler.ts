import {
  buildRequestContext,
  captureException,
  initSentry,
  type RequestContext,
  withSentryRequestScope,
} from "./sentry.ts";
import { createLogger } from "./logger.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;

  constructor(status: number, code: string, publicMessage: string) {
    super(publicMessage);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

const toStatusCode = (error: unknown): number => {
  if (isApiError(error)) return error.status;

  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }
  }

  if (error instanceof SyntaxError) {
    return 400;
  }

  return 500;
};

const toErrorCode = (status: number): string => {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "internal_server_error";
};

const toPublicMessage = (error: unknown, status: number): string => {
  if (isApiError(error)) return error.publicMessage;

  if (error instanceof Error && status >= 400 && status < 500) {
    return error.message || "Request failed";
  }

  if (status === 400) return "Bad request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not found";
  return "Unexpected server error";
};

export const handleError = (
  error: unknown,
  context: Partial<RequestContext> & { functionName: string },
  options?: { corsHeaders?: Record<string, string> },
): Response => {
  const status = toStatusCode(error);
  const code = toErrorCode(status);
  const message = toPublicMessage(error, status);

  const logger = createLogger({
    functionName: context.functionName,
    requestId: context.requestId,
  });

  if (status >= 500) {
    captureException(error, context);
    logger.error("request_failed", {
      status,
      code,
      error,
    });
  } else {
    logger.warn("request_rejected", {
      status,
      code,
      message,
    });
  }

  return new Response(
    JSON.stringify({
      error: code,
      message,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
        ...(options?.corsHeaders ?? {}),
      },
    },
  );
};

export const serveWithErrorHandling = (
  functionName: string,
  handler: (req: Request, context: RequestContext) => Promise<Response> | Response,
) => {
  initSentry(functionName);

  return Deno.serve(async (req: Request): Promise<Response> => {
    const context = buildRequestContext(functionName, req);
    const logger = createLogger({
      functionName: context.functionName,
      requestId: context.requestId,
    });

    return await withSentryRequestScope(context, async () => {
      try {
        logger.info("request_received", {
          method: context.method,
          path: context.path,
          body_size: context.bodySize,
          user_id: context.userId,
        });

        const response = await handler(req, context);

        // Handlers that catch internally and return a 5xx Response bypass the
        // outer catch. Capture those here so they appear in Sentry.
        if (response.status >= 500) {
          captureException(
            new Error(`[${context.functionName}] HTTP ${response.status}`),
            context,
          );
        }

        logger.info("request_completed", {
          status: response.status,
        });
        return response;
      } catch (error) {
        // Build CORS headers for error response
        const origin = req.headers.get("origin");
        const corsHeaders: Record<string, string> = origin
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            }
          : {
              "Access-Control-Allow-Origin": "null",
            };

        return handleError(error, context, { corsHeaders });
      }
    });
  });
};
