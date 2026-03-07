/*
  # Add dedicated rate limit for get-master-url

  Rule:
  - get_master_url_user: 30 requests / minute / user
*/

BEGIN;

INSERT INTO public.rpc_rate_limit_rules (
  rpc_name,
  scope,
  allowed_per_minute,
  is_enabled
)
VALUES (
  'get_master_url_user',
  'per_user',
  30,
  true
)
ON CONFLICT (rpc_name)
DO UPDATE SET
  scope = EXCLUDED.scope,
  allowed_per_minute = EXCLUDED.allowed_per_minute,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

COMMIT;
