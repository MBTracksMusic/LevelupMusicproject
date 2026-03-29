import { supabase } from '@/lib/supabase/client';

type EdgeFunctionBody =
  | string
  | Record<string, unknown>
  | Blob
  | ArrayBuffer
  | FormData
  | null;

export async function getFreshAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('User is not authenticated. Please sign in first.');
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();

  if (!refreshError && refreshed?.session?.access_token) {
    return refreshed.session.access_token;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (!userError && userData.user && session.access_token) {
    return session.access_token;
  }

  throw new Error('Authentication expired. Please sign in again.');
}

/**
 * Invoke a protected Edge Function with automatic Authorization header.
 *
 * CRITICAL: The Supabase JS SDK does NOT automatically send the user's JWT token
 * to Edge Functions. This helper extracts the session token and includes it in
 * the Authorization header.
 *
 * @param functionName - Name of the Edge Function to invoke
 * @param body - Request body (optional)
 * @returns Response from the Edge Function
 * @throws Error if user is not authenticated
 *
 * @example
 * const { data, error } = await invokeWithAuth('toggle-maintenance', {
 *   maintenance_mode: true
 * });
 */
export async function invokeWithAuth<T = unknown>(
  functionName: string,
  body?: EdgeFunctionBody,
) {
  const token = await getFreshAccessToken();

  return supabase.functions.invoke<T>(functionName, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body,
  });
}
