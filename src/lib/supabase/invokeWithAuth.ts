import { supabase } from '@/lib/supabase/client';

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
  body?: unknown,
) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('User is not authenticated. Please sign in first.');
  }

  return supabase.functions.invoke<T>(functionName, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body,
  });
}
