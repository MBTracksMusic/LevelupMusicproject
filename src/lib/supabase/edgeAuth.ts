import { supabase } from './client';
import { getFreshAccessToken } from './invokeWithAuth';

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseInvokeError = async (
  error: { message?: string; status?: number; context?: unknown },
  data: unknown,
) => {
  const apiPayload = (data && typeof data === 'object')
    ? data as Record<string, unknown>
    : null;
  const apiError = asNonEmptyString(apiPayload?.error);
  const apiMessage = asNonEmptyString(apiPayload?.message);

  let contextError: string | null = null;
  let contextMessage: string | null = null;
  const context = error.context;

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as Record<string, unknown>;
      contextError = asNonEmptyString(payload.error);
      contextMessage = asNonEmptyString(payload.message);
    } catch {
      try {
        contextError = asNonEmptyString(await context.clone().text());
      } catch {
        contextError = null;
      }
    }
  }

  const rawMessage = [
    apiError,
    contextError,
    apiMessage,
    contextMessage,
    asNonEmptyString(error.message),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' | ');

  return {
    message: rawMessage || 'Edge function call failed',
  };
};

interface InvokeProtectedEdgeFunctionOptions {
  body?: unknown;
}

export async function invokeProtectedEdgeFunction<TData>(
  functionName: string,
  options: InvokeProtectedEdgeFunctionOptions = {},
) {
  const token = await getFreshAccessToken();

  console.log(`🔍 ${functionName.toUpperCase()} TOKEN:`, `Bearer ${token.substring(0, 20)}...`);

  const result = await supabase.functions.invoke<TData>(functionName, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: options.body ?? {},
  });

  if (result.error) {
    const parsedError = await parseInvokeError(result.error, result.data);
    throw new Error(parsedError.message);
  }

  return result.data;
}
