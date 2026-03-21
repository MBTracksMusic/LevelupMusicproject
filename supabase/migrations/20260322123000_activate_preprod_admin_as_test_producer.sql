/*
  # Pre-production fixture: activate the admin validation account as a producer

  Why:
  - Pre-production validation of generate-battle-suggestions requires one authenticated
    account that satisfies the same "active producer" gate as production users.
  - The current admin validation account already has a valid session, but is not an
    active producer.

  Scope:
  - Seed/refresh one producer_subscriptions row for the existing admin validation user.
  - Let the existing sync trigger set user_profiles.is_producer_active.
  - Align the profile tier/subscription identifiers with the seeded producer subscription.

  Safety:
  - Targets one fixed user id only.
  - Idempotent via ON CONFLICT (user_id).
*/

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = '253e4c48-1875-429b-8461-dc87341a50f4'::uuid
  ) THEN
    RAISE EXCEPTION 'Preprod producer fixture target user not found';
  END IF;
END
$$;

INSERT INTO public.producer_subscriptions (
  user_id,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_status,
  current_period_end,
  cancel_at_period_end
)
VALUES (
  '253e4c48-1875-429b-8461-dc87341a50f4'::uuid,
  'cus_UBAPtU0i1EtTCx',
  'sub_preprod_generate_battle_suggestions_admin_20260322',
  'active',
  now() + interval '30 days',
  false
)
ON CONFLICT (user_id) DO UPDATE
SET stripe_customer_id = EXCLUDED.stripe_customer_id,
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    subscription_status = EXCLUDED.subscription_status,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    updated_at = now();

UPDATE public.user_profiles
SET producer_tier = 'producteur'::public.producer_tier_type,
    stripe_subscription_id = 'sub_preprod_generate_battle_suggestions_admin_20260322',
    updated_at = now()
WHERE id = '253e4c48-1875-429b-8461-dc87341a50f4'::uuid;

COMMIT;
