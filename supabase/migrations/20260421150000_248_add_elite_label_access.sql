/*
  # Elite Producer System + Private Label Access

  Safe extension only:
  - add account_type + is_verified on user_profiles
  - add is_elite on products
  - add label_requests workflow table
  - expose new profile fields through my_user_profile
  - keep new sensitive flags admin-controlled through RLS
*/

BEGIN;

-- ============================================================================
-- 1. user_profiles: elite / label flags
-- ============================================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_account_type_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_account_type_check
  CHECK (account_type IN ('user', 'producer', 'elite_producer', 'label'));

UPDATE public.user_profiles
SET account_type = CASE
  WHEN role = 'producer' OR is_producer_active = true THEN 'producer'
  ELSE 'user'
END
WHERE account_type IS NULL
   OR btrim(account_type) = ''
   OR (
     account_type = 'user'
     AND (role = 'producer' OR is_producer_active = true)
   );

UPDATE public.user_profiles
SET is_verified = false
WHERE is_verified IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_account_type
  ON public.user_profiles (account_type);

CREATE INDEX IF NOT EXISTS idx_user_profiles_verified_labels
  ON public.user_profiles (id)
  WHERE account_type = 'label' AND is_verified = true;

DROP POLICY IF EXISTS "Owner can update own profile" ON public.user_profiles;
CREATE POLICY "Owner can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND COALESCE(is_deleted, false) = false
  AND deleted_at IS NULL
  AND role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid())
  AND producer_tier IS NOT DISTINCT FROM (SELECT producer_tier FROM public.user_profiles WHERE id = auth.uid())
  AND is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid())
  AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid())
  AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid())
  AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid())
  AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid())
  AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid())
  AND battle_refusal_count IS NOT DISTINCT FROM (SELECT battle_refusal_count FROM public.user_profiles WHERE id = auth.uid())
  AND battles_participated IS NOT DISTINCT FROM (SELECT battles_participated FROM public.user_profiles WHERE id = auth.uid())
  AND battles_completed IS NOT DISTINCT FROM (SELECT battles_completed FROM public.user_profiles WHERE id = auth.uid())
  AND engagement_score IS NOT DISTINCT FROM (SELECT engagement_score FROM public.user_profiles WHERE id = auth.uid())
  AND elo_rating IS NOT DISTINCT FROM (SELECT elo_rating FROM public.user_profiles WHERE id = auth.uid())
  AND battle_wins IS NOT DISTINCT FROM (SELECT battle_wins FROM public.user_profiles WHERE id = auth.uid())
  AND battle_losses IS NOT DISTINCT FROM (SELECT battle_losses FROM public.user_profiles WHERE id = auth.uid())
  AND battle_draws IS NOT DISTINCT FROM (SELECT battle_draws FROM public.user_profiles WHERE id = auth.uid())
  AND is_deleted IS NOT DISTINCT FROM (SELECT is_deleted FROM public.user_profiles WHERE id = auth.uid())
  AND deleted_at IS NOT DISTINCT FROM (SELECT deleted_at FROM public.user_profiles WHERE id = auth.uid())
  AND delete_reason IS NOT DISTINCT FROM (SELECT delete_reason FROM public.user_profiles WHERE id = auth.uid())
  AND deleted_label IS NOT DISTINCT FROM (SELECT deleted_label FROM public.user_profiles WHERE id = auth.uid())
  AND account_type IS NOT DISTINCT FROM (SELECT account_type FROM public.user_profiles WHERE id = auth.uid())
  AND is_verified IS NOT DISTINCT FROM (SELECT is_verified FROM public.user_profiles WHERE id = auth.uid())
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_profiles'
      AND policyname = 'Admins can update all user profiles'
  ) THEN
    CREATE POLICY "Admins can update all user profiles"
      ON public.user_profiles
      FOR UPDATE
      TO authenticated
      USING (public.is_admin(auth.uid()))
      WITH CHECK (public.is_admin(auth.uid()));
  END IF;
END;
$$;

-- ============================================================================
-- 2. products: elite flag, kept admin-controlled
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_elite boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_elite_beats
  ON public.products (created_at DESC)
  WHERE product_type = 'beat'
    AND is_elite = true
    AND is_published = true
    AND deleted_at IS NULL
    AND status = 'active';

DROP POLICY IF EXISTS "Active producers can create products" ON public.products;
CREATE POLICY "Active producers can create products"
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    producer_id = auth.uid()
    AND public.is_current_user_active(auth.uid()) = true
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
        AND COALESCE(up.is_deleted, false) = false
        AND up.deleted_at IS NULL
    )
    AND COALESCE(is_elite, false) = false
    AND (
      NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL)
      OR public.can_publish_beat(auth.uid(), NULL)
    )
  );

DROP POLICY IF EXISTS "Producers can update own unsold products" ON public.products;
CREATE POLICY "Producers can update own unsold products"
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (
    producer_id = auth.uid()
    AND deleted_at IS NULL
    AND public.is_current_user_active(auth.uid()) = true
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
        AND COALESCE(up.is_deleted, false) = false
        AND up.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.purchases pu
      WHERE pu.product_id = products.id
        AND pu.status IN ('completed', 'refunded')
    )
  )
  WITH CHECK (
    producer_id = auth.uid()
    AND deleted_at IS NULL
    AND public.is_current_user_active(auth.uid()) = true
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
        AND COALESCE(up.is_deleted, false) = false
        AND up.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.purchases pu
      WHERE pu.product_id = products.id
        AND pu.status IN ('completed', 'refunded')
    )
    AND is_elite IS NOT DISTINCT FROM (
      SELECT current_product.is_elite
      FROM public.products AS current_product
      WHERE current_product.id = products.id
    )
    AND (
      NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL)
      OR public.can_publish_beat(auth.uid(), id)
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname = 'Admins can update products'
  ) THEN
    CREATE POLICY "Admins can update products"
      ON public.products
      FOR UPDATE
      TO authenticated
      USING (public.is_admin(auth.uid()))
      WITH CHECK (public.is_admin(auth.uid()));
  END IF;
END;
$$;

-- ============================================================================
-- 3. label_requests: private workflow for labels
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.label_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  company_name text NOT NULL CHECK (btrim(company_name) <> ''),
  email text NOT NULL CHECK (btrim(email) <> ''),
  message text NOT NULL CHECK (btrim(message) <> ''),
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT label_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT label_requests_review_state_check CHECK (
    (
      status = 'pending'
      AND reviewed_at IS NULL
      AND reviewed_by IS NULL
    )
    OR (
      status IN ('approved', 'rejected')
      AND reviewed_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_label_requests_one_pending_per_user
  ON public.label_requests (user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_label_requests_status_created_at
  ON public.label_requests (status, created_at DESC);

ALTER TABLE public.label_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.label_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.label_requests FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.label_requests TO authenticated;
GRANT ALL ON TABLE public.label_requests TO service_role;

DROP POLICY IF EXISTS "Users can read own label requests" ON public.label_requests;
CREATE POLICY "Users can read own label requests"
  ON public.label_requests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own label requests" ON public.label_requests;
CREATE POLICY "Users can create own label requests"
  ON public.label_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
  );

DROP POLICY IF EXISTS "Admins can read label requests" ON public.label_requests;
CREATE POLICY "Admins can read label requests"
  ON public.label_requests
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update label requests" ON public.label_requests;
CREATE POLICY "Admins can update label requests"
  ON public.label_requests
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_label_requests_updated_at ON public.label_requests;
CREATE TRIGGER update_label_requests_updated_at
  BEFORE UPDATE ON public.label_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 4. my_user_profile: expose account_type + is_verified for frontend guards
-- ============================================================================

CREATE OR REPLACE VIEW public.my_user_profile AS
SELECT
  up.id,
  up.id                         AS user_id,
  up.username,
  up.full_name,
  up.avatar_url,
  up.role,
  up.producer_tier,
  up.is_producer_active,
  up.total_purchases,
  up.confirmed_at,
  up.producer_verified_at,
  up.battle_refusal_count,
  up.battles_participated,
  up.battles_completed,
  up.engagement_score,
  up.language,
  up.bio,
  up.website_url,
  up.social_links,
  up.created_at,
  up.updated_at,
  up.is_deleted,
  up.deleted_at,
  up.delete_reason,
  up.deleted_label,
  up.is_founding_producer,
  up.founding_trial_start,
  up.producer_campaign_type,
  pc.label                      AS producer_campaign_label,
  pc.trial_duration             AS campaign_trial_duration,
  CASE
    WHEN up.founding_trial_start IS NOT NULL AND pc.trial_duration IS NOT NULL
    THEN up.founding_trial_start + pc.trial_duration
    ELSE NULL
  END                           AS founding_trial_end,
  (
    up.producer_campaign_type IS NOT NULL
    AND up.founding_trial_start IS NOT NULL
    AND pc.is_active = true
    AND now() < up.founding_trial_start + pc.trial_duration
  )                             AS founding_trial_active,
  (
    up.producer_campaign_type IS NOT NULL
    AND up.founding_trial_start IS NOT NULL
    AND now() >= up.founding_trial_start + pc.trial_duration
    AND up.is_producer_active = false
  )                             AS founding_trial_expired,
  (
    up.is_producer_active = true
    OR (
      up.producer_campaign_type IS NOT NULL
      AND up.founding_trial_start IS NOT NULL
      AND pc.is_active = true
      AND now() < up.founding_trial_start + pc.trial_duration
    )
  )                             AS can_access_producer_features,
  up.account_type,
  up.is_verified
FROM public.user_profiles up
LEFT JOIN public.producer_campaigns pc ON pc.type = up.producer_campaign_type
WHERE up.id = auth.uid();

ALTER VIEW public.my_user_profile SET (security_invoker = true);

REVOKE ALL ON TABLE public.my_user_profile FROM PUBLIC;
REVOKE ALL ON TABLE public.my_user_profile FROM anon;
REVOKE ALL ON TABLE public.my_user_profile FROM authenticated;
GRANT SELECT ON TABLE public.my_user_profile TO authenticated;
GRANT SELECT ON TABLE public.my_user_profile TO service_role;

COMMIT;
