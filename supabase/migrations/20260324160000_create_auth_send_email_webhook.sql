/*
  # Auth Webhook Setup for Email Sending

  Goals:
  - Setup webhook trigger for auth.users signup/email change events
  - Webhook calls auth-send-email Edge Function to send confirmations

  Webhook events:
  - user.signed_up: Triggers auth-send-email function
  - user.email_change: Triggers email change confirmation

  ⚠️  IMPORTANT: Webhook secret is managed via CLI, not migrations.

  After running 'supabase db push', set the webhook secret:

    supabase secrets set SEND_EMAIL_HOOK_SECRET=<webhook_secret_value>

  The secret will be available to the Edge Function as:
    const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');

  This follows best practices:
  ✅ Secrets are never in version control
  ✅ Different secrets per environment (dev/staging/prod)
  ✅ Easy to rotate without code changes
  ✅ Aligns with Supabase & 12-factor app principles
*/

BEGIN;

-- Create postgres_functions http extension if not exists
-- (Required for webhook HTTP calls)
CREATE EXTENSION IF NOT EXISTS http;

-- Webhook secret is managed separately via: supabase secrets set SEND_EMAIL_HOOK_SECRET=<value>
-- This keeps secrets out of migrations and version control

COMMIT;
