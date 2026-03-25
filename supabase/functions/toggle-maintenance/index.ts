import { createClient } from 'jsr:@supabase/supabase-js@2';

interface RequestBody {
  maintenance_mode: boolean;
}

interface ErrorResponse {
  error: string;
  message?: string;
  details?: unknown;
}

interface SuccessResponse {
  success: true;
  maintenance_mode: boolean;
  updated_at: string;
}

type Response = ErrorResponse | SuccessResponse;

// ✅ CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};

/**
 * TOGGLE-MAINTENANCE Edge Function (FIXED VERSION)
 *
 * Safely toggles maintenance mode for admins.
 *
 * Security measures:
 * 1. Verifies JWT in Authorization header using PUBLIC key
 * 2. Checks user exists and is admin via SERVICE_ROLE client (bypasses RLS)
 * 3. Updates settings singleton row (with WHERE clause!)
 * 4. Returns clear error messages for debugging
 *
 * CRITICAL FIXES:
 * - Added WHERE clause to UPDATE (targets only settings.id)
 * - Uses PUBLIC key for auth verification
 * - Queries settings.id before updating
 * - Clear client separation (auth vs admin)
 *
 * Usage:
 *   supabase.functions.invoke('toggle-maintenance', {
 *     body: { maintenance_mode: true }
 *   })
 */

Deno.serve(async (req: Request): Promise<Response> => {
  // === 1. CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // === 2. Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'method_not_allowed',
      message: 'Only POST is allowed',
    } as ErrorResponse), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // === 3. Parse request body
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({
        error: 'invalid_json',
        message: 'Request body must be valid JSON',
      } as ErrorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // === 4. Validate body
    if (typeof body.maintenance_mode !== 'boolean') {
      return new Response(JSON.stringify({
        error: 'invalid_body',
        message: 'Body must contain { maintenance_mode: boolean }',
      } as ErrorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // === 5. Extract and verify JWT
    const authHeader = req.headers.get('authorization');
    console.log('[toggle-maintenance] Authorization header received:', {
      hasAuthHeader: !!authHeader,
      authHeaderPrefix: authHeader?.slice(0, 20) + '...',
    });

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        error: 'no_auth',
        message: 'Missing or invalid Authorization header',
      } as ErrorResponse), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const token = authHeader.slice(7);

    // === 6. Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      console.error('[toggle-maintenance] Missing Supabase config');
      return new Response(JSON.stringify({
        error: 'internal_error',
        message: 'Server configuration error',
      } as ErrorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ✅ FIXED: Client with PUBLIC key for auth verification (user level)
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { authorization: `Bearer ${token}` } },
    });

    // === 7. Get current user via token
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    console.log('[toggle-maintenance] getUser() result:', {
      hasUser: !!user,
      userId: user?.id,
      authError: authError?.message,
    });

    if (authError || !user?.id) {
      console.warn('[toggle-maintenance] Auth verification failed', authError?.message);
      return new Response(JSON.stringify({
        error: 'auth_failed',
        message: 'Invalid or expired JWT token',
      } as ErrorResponse), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const userId = user.id;

    // === 8. Verify admin status using SERVICE_ROLE
    // This bypasses RLS and checks user_profiles.role directly
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role, is_deleted, deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[toggle-maintenance] Profile lookup error:', profileError.message);
      return new Response(JSON.stringify({
        error: 'profile_lookup_failed',
        message: 'Failed to verify admin status',
      } as ErrorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (!profile) {
      console.warn('[toggle-maintenance] User profile not found', { userId });
      return new Response(JSON.stringify({
        error: 'profile_not_found',
        message: 'User profile does not exist',
      } as ErrorResponse), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // === 9. Check admin role
    const isAdmin = profile.role === 'admin'
      && !profile.is_deleted
      && !profile.deleted_at;

    if (!isAdmin) {
      console.warn('[toggle-maintenance] Admin check failed', {
        userId,
        role: profile.role,
        is_deleted: profile.is_deleted,
      });
      return new Response(JSON.stringify({
        error: 'forbidden',
        message: 'Only admins can toggle maintenance mode',
      } as ErrorResponse), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ✅ FIXED: Query the settings singleton to get its ID
    const { data: settingsRow, error: settingsQueryError } = await supabaseAdmin
      .from('settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (settingsQueryError) {
      console.error('[toggle-maintenance] Settings query failed:', settingsQueryError.message);
      return new Response(JSON.stringify({
        error: 'settings_query_failed',
        message: 'Failed to query settings',
      } as ErrorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (!settingsRow?.id) {
      console.warn('[toggle-maintenance] Settings singleton not found');
      return new Response(JSON.stringify({
        error: 'settings_not_found',
        message: 'Settings singleton row not found. Database may not be initialized.',
      } as ErrorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // === 10. Update settings with SERVICE_ROLE
    // ✅ FIXED: Added .eq('id', settingsRow.id) WHERE clause
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('settings')
      .update({
        maintenance_mode: body.maintenance_mode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settingsRow.id)  // ✅ WHERE clause: update only this specific row
      .select('maintenance_mode, updated_at')
      .single();

    if (updateError) {
      console.error('[toggle-maintenance] Update failed:', updateError.message);
      return new Response(JSON.stringify({
        error: 'update_failed',
        message: 'Failed to update maintenance mode',
        details: updateError.message,
      } as ErrorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (!updated) {
      console.warn('[toggle-maintenance] Settings result not found after update');
      return new Response(JSON.stringify({
        error: 'update_result_not_found',
        message: 'Settings update succeeded but result not found.',
      } as ErrorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // === 11. Success - log action
    console.log('[toggle-maintenance] Success', {
      userId,
      settingsId: settingsRow.id,
      maintenance_mode: updated.maintenance_mode,
      updated_at: updated.updated_at,
    });

    return new Response(JSON.stringify({
      success: true,
      maintenance_mode: updated.maintenance_mode,
      updated_at: updated.updated_at,
    } as SuccessResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[toggle-maintenance] Unexpected error:', error);
    return new Response(JSON.stringify({
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    } as ErrorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
});
