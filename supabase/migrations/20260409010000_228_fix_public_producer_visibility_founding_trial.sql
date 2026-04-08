/*
  # Fix public producer visibility for founding trial producers

  ## Problème
  La migration 227 a incorrectement ajouté `is_producer_active = true` dans
  admin_assign_producer_campaign. Or is_producer_active est "owned by Stripe trigger"
  (migration 221 ligne 9) — le setter à true manuellement casse le paywall d'expiration
  du trial founding (founding_trial_expired dépend de is_producer_active = false).

  ## Solution
  1. Revert admin_assign_producer_campaign : ne plus toucher is_producer_active
  2. Fixer get_public_visible_producer_profiles : le champ is_producer_active retourné
     devient "effective" = Stripe actif OU founding trial actif.
     La valeur stockée dans user_profiles reste false pour les founding producers
     sans Stripe, préservant le calcul de founding_trial_expired.

  ## Impact
  - Founding producers avec trial actif apparaissent sur la page /producteurs ✅
  - founding_trial_expired se déclenche correctement après 3 mois ✅
  - Stripe continue d'être la seule source de vérité pour is_producer_active ✅
*/

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Revert admin_assign_producer_campaign : retirer is_producer_active = true
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_assign_producer_campaign(
  p_user_id       uuid,
  p_campaign_type text,
  p_trial_start   timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign     public.producer_campaigns%ROWTYPE;
  v_slot_count   int := 0;
  v_current_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_campaign
  FROM public.producer_campaigns
  WHERE type = p_campaign_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found: %', p_campaign_type
      USING ERRCODE = 'P0002';
  END IF;

  IF v_campaign.is_active = false THEN
    RAISE EXCEPTION 'Campaign % is not active', p_campaign_type
      USING ERRCODE = '22023';
  END IF;

  IF v_campaign.max_slots IS NOT NULL THEN
    SELECT count(*) INTO v_slot_count
    FROM public.user_profiles
    WHERE producer_campaign_type = p_campaign_type;

    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = p_user_id AND producer_campaign_type = p_campaign_type
    ) THEN
      IF v_slot_count >= v_campaign.max_slots THEN
        RAISE EXCEPTION 'Campaign % is full (% / % slots used)',
          p_campaign_type, v_slot_count, v_campaign.max_slots
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    SELECT count(*) INTO v_slot_count
    FROM public.user_profiles
    WHERE producer_campaign_type = p_campaign_type;
  END IF;

  SELECT role INTO v_current_role
  FROM public.user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id
      USING ERRCODE = '02000';
  END IF;

  -- NOTE: is_producer_active intentionnellement non modifié.
  -- Il est owned by le trigger Stripe (trg_sync_user_profile_producer).
  -- La visibilité publique est gérée par get_public_visible_producer_profiles
  -- qui calcule un is_producer_active "effectif" (Stripe OU founding trial actif).
  UPDATE public.user_profiles
  SET
    producer_campaign_type = p_campaign_type,
    is_founding_producer   = CASE
                               WHEN p_campaign_type = 'founding' THEN true
                               ELSE is_founding_producer
                             END,
    founding_trial_start   = COALESCE(
                               CASE
                                 WHEN producer_campaign_type = p_campaign_type
                                 THEN founding_trial_start
                               END,
                               p_trial_start
                             ),
    role                   = CASE
                               WHEN v_current_role = 'admin' THEN 'admin'::public.user_role
                               ELSE 'producer'::public.user_role
                             END,
    producer_tier          = 'producteur'::public.producer_tier_type,
    updated_at             = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id',       p_user_id,
    'campaign_type', p_campaign_type,
    'trial_start',   p_trial_start,
    'trial_end',     p_trial_start + v_campaign.trial_duration,
    'slots_used',    v_slot_count + 1,
    'slots_max',     v_campaign.max_slots
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_assign_producer_campaign(uuid, text, timestamptz)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_assign_producer_campaign(uuid, text, timestamptz)
  FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix get_public_visible_producer_profiles
--    is_producer_active retourné = Stripe actif OU founding trial actif
--    La valeur stockée dans user_profiles.is_producer_active n'est pas modifiée.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_public_visible_producer_profiles()
RETURNS TABLE (
  user_id uuid,
  raw_username text,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  bio text,
  social_links jsonb,
  xp bigint,
  level integer,
  rank_tier text,
  reputation_score numeric,
  is_deleted boolean,
  is_producer_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    up.id AS user_id,
    up.username AS raw_username,
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    up.producer_tier,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.bio
    END AS bio,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN '{}'::jsonb
      ELSE COALESCE(up.social_links, '{}'::jsonb)
    END AS social_links,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    (COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL) AS is_deleted,
    -- is_producer_active "effectif" : Stripe actif OU founding trial dans la fenêtre de 3 mois.
    -- Ne reflète PAS user_profiles.is_producer_active directement (owned by Stripe trigger).
    (
      COALESCE(up.is_producer_active, false) = true
      OR (
        up.is_founding_producer = true
        AND up.founding_trial_start IS NOT NULL
        AND now() < up.founding_trial_start + interval '3 months'
      )
    ) AS is_producer_active,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL
    AND COALESCE(up.is_deleted, false) = false
    AND up.deleted_at IS NULL
    AND up.role = 'producer'
    AND (
      COALESCE(up.is_producer_active, false) = true
      OR (
        up.is_founding_producer = true
        AND up.founding_trial_start IS NOT NULL
        AND now() < up.founding_trial_start + interval '3 months'
      )
      OR up.producer_tier IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.producer_id = up.id
          AND p.deleted_at IS NULL
          AND p.status = 'active'
          AND p.is_published = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.battles b
        WHERE b.status IN ('active', 'voting', 'completed')
          AND (b.producer1_id = up.id OR b.producer2_id = up.id)
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_public_visible_producer_profiles()
  TO anon, authenticated;

COMMIT;
