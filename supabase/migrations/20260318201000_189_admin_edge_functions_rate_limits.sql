/*
  # Rate limit rules for admin-facing Edge Functions

  Registers per-minute call limits for three sensitive endpoints:
  - enqueue-preview-reprocess  : 3 / minute / admin user  (mass job trigger)
  - repair-email-delivery      : 5 / minute / global       (secret endpoint, no user identity)
  - admin-reply-contact-message: 10 / minute / admin user  (email dispatch)

  Uses the existing check_rpc_rate_limit() infrastructure.
  Scope 'per_admin' keys the counter on p_user_id.
  Scope 'global'    keys the counter on the literal string 'global'.
*/

BEGIN;

INSERT INTO public.rpc_rate_limit_rules (rpc_name, scope, allowed_per_minute, is_enabled)
VALUES
  ('enqueue_preview_reprocess',   'per_admin', 3,  true),
  ('repair_email_delivery',       'global',    5,  true),
  ('admin_reply_contact_message', 'per_admin', 10, true)
ON CONFLICT (rpc_name)
DO UPDATE SET
  scope              = EXCLUDED.scope,
  allowed_per_minute = EXCLUDED.allowed_per_minute,
  is_enabled         = EXCLUDED.is_enabled,
  updated_at         = now();

COMMIT;
