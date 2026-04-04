/*
  # Producer Campaigns System

  ## Objectif
  Rendre le système founding producer extensible à plusieurs campagnes admin.

  ## Stratégie
  - Non destructif : is_founding_producer + founding_trial_start restent en place
  - Additive : on ajoute une table campaign + un champ FK dans user_profiles
  - Backfill : les founding producers existants sont assignés à la campagne 'founding'
  - Backward compat : admin_activate_founding_producer() devient un wrapper

  ## Architecture
  user_profiles.producer_campaign_type → FK → producer_campaigns.type
  La vue my_user_profile lit la durée du trial depuis producer_campaigns
  (plus de hardcode interval '3 months' dans la vue)

  ## Tables modifiées
  - producer_campaigns : nouvelle table de config (5 colonnes)
  - user_profiles : nouvelle colonne producer_campaign_type (FK nullable)
  - my_user_profile (vue) : durée dynamic + nouveau champ producer_campaign_type

  ## Fonctions
  - admin_assign_producer_campaign() : point d'entrée générique
  - admin_activate_founding_producer() : wrapper rétrocompat
  - admin_list_campaign_producers() : visibilité admin
  - is_founding_trial_active() : mis à jour (appel générique), même signature
*/

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table de config des campagnes
--    Simple, 5 colonnes, gérée par admin
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.producer_campaigns (
  type           text        PRIMARY KEY,
  label          text        NOT NULL,
  trial_duration interval    NOT NULL DEFAULT interval '3 months',
  max_slots      int         NULL CHECK (max_slots IS NULL OR max_slots > 0),
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS : seuls les admins écrivent ; authentifiés lisent (pour potentielle UI future)
ALTER TABLE public.producer_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Campaigns: admin write" ON public.producer_campaigns;
CREATE POLICY "Campaigns: admin write"
  ON public.producer_campaigns
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Campaigns: authenticated read" ON public.producer_campaigns;
CREATE POLICY "Campaigns: authenticated read"
  ON public.producer_campaigns
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.producer_campaigns TO authenticated;
GRANT ALL    ON public.producer_campaigns TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Seed : campagne founding (identique au comportement actuel)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.producer_campaigns (type, label, trial_duration, max_slots, is_active)
VALUES ('founding', 'Founding Producers', interval '3 months', 20, true)
ON CONFLICT (type) DO UPDATE
  SET
    label          = EXCLUDED.label,
    trial_duration = EXCLUDED.trial_duration,
    is_active      = EXCLUDED.is_active
    -- max_slots intentionnellement non écrasé : peut avoir été modifié manuellement
;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Nouvelle colonne dans user_profiles
--    FK nullable → un producteur sans campagne a NULL
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS producer_campaign_type text
    REFERENCES public.producer_campaigns(type)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_campaign_type
  ON public.user_profiles (producer_campaign_type)
  WHERE producer_campaign_type IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill : aligner les founding producers existants sur la campagne 'founding'
--    Idempotent : ON CONFLICT / WHERE clause
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.user_profiles
SET
  producer_campaign_type = 'founding',
  updated_at             = now()
WHERE is_founding_producer = true
  AND producer_campaign_type IS DISTINCT FROM 'founding';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Vue my_user_profile reconstruite
--    - Tous les champs existants conservés à l'identique
--    - Durée du trial lue depuis producer_campaigns (fini le hardcode '3 months')
--    - Nouveau champ producer_campaign_type exposé au frontend
--    - founding_trial_* conservés pour backward compat (même sémantique)
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.my_user_profile;

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

  -- ── Founding fields (backward compat, valeurs inchangées) ────────────────

  up.is_founding_producer,
  up.founding_trial_start,

  -- ── Campaign fields (nouveau) ────────────────────────────────────────────

  -- Type de campagne assignée ('founding', 'invite', NULL si aucune)
  up.producer_campaign_type,

  -- Label de la campagne (ex: 'Founding Producers') — NULL si pas de campagne
  pc.label                      AS producer_campaign_label,

  -- Durée du trial lue depuis la table campaign — NULL si pas de campagne
  pc.trial_duration             AS campaign_trial_duration,

  -- ── Champs calculés (logique SQL pure, durée dynamique) ──────────────────

  -- Date de fin du trial (calculée depuis la config campaign)
  CASE
    WHEN up.founding_trial_start IS NOT NULL AND pc.trial_duration IS NOT NULL
    THEN up.founding_trial_start + pc.trial_duration
    ELSE NULL
  END                           AS founding_trial_end,

  -- Trial actif : campagne assignée + active + dans la fenêtre de durée
  (
    up.producer_campaign_type IS NOT NULL
    AND up.founding_trial_start IS NOT NULL
    AND pc.is_active = true
    AND now() < up.founding_trial_start + pc.trial_duration
  )                             AS founding_trial_active,

  -- Trial expiré ET pas de Stripe actif → paywall
  (
    up.producer_campaign_type IS NOT NULL
    AND up.founding_trial_start IS NOT NULL
    AND now() >= up.founding_trial_start + pc.trial_duration
    AND up.is_producer_active = false
  )                             AS founding_trial_expired,

  -- Accès producteur : Stripe actif OU trial de campagne actif
  -- Source de vérité finale pour les permissions frontend
  (
    up.is_producer_active = true
    OR (
      up.producer_campaign_type IS NOT NULL
      AND up.founding_trial_start IS NOT NULL
      AND pc.is_active = true
      AND now() < up.founding_trial_start + pc.trial_duration
    )
  )                             AS can_access_producer_features

FROM public.user_profiles up
LEFT JOIN public.producer_campaigns pc ON pc.type = up.producer_campaign_type
WHERE up.id = auth.uid();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Fonction admin générique : assigner un producteur à une campagne
--    Point d'entrée unique pour toutes les campagnes futures
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_assign_producer_campaign(
  p_user_id      uuid,
  p_campaign_type text,
  p_trial_start  timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign     public.producer_campaigns%ROWTYPE;
  v_slot_count   int;
  v_current_role text;
BEGIN
  -- ── Vérification admin ──────────────────────────────────────────────────
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required'
      USING ERRCODE = '42501';
  END IF;

  -- ── Vérification que la campagne existe et est active ───────────────────
  SELECT * INTO v_campaign
  FROM public.producer_campaigns
  WHERE type = p_campaign_type;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found: %', p_campaign_type
      USING ERRCODE = 'P0002';
  END IF;

  IF v_campaign.is_active = false THEN
    RAISE EXCEPTION 'Campaign % is not active', p_campaign_type
      USING ERRCODE = '22023';
  END IF;

  -- ── Vérification des slots disponibles ─────────────────────────────────
  IF v_campaign.max_slots IS NOT NULL THEN
    SELECT count(*) INTO v_slot_count
    FROM public.user_profiles
    WHERE producer_campaign_type = p_campaign_type;

    -- Ne pas compter le user lui-même s'il est déjà dans la campagne (idempotence)
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
  END IF;

  -- ── Vérification que l'utilisateur existe ───────────────────────────────
  SELECT role INTO v_current_role
  FROM public.user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id
      USING ERRCODE = '02000';
  END IF;

  -- ── Activation ──────────────────────────────────────────────────────────
  -- Note : is_founding_producer reste true pour la campagne 'founding'
  -- Note : is_producer_active N'EST PAS modifié (owned by Stripe trigger)
  UPDATE public.user_profiles
  SET
    producer_campaign_type = p_campaign_type,
    is_founding_producer   = CASE
                               WHEN p_campaign_type = 'founding' THEN true
                               ELSE is_founding_producer  -- ne pas toucher pour les autres campagnes
                             END,
    founding_trial_start   = COALESCE(
                               -- Idempotent : ne pas réinitialiser si déjà dans cette campagne
                               CASE
                                 WHEN producer_campaign_type = p_campaign_type
                                 THEN founding_trial_start
                               END,
                               p_trial_start
                             ),
    role                   = CASE
                               WHEN v_current_role = 'admin' THEN 'admin'
                               ELSE 'producer'
                             END,
    producer_tier          = 'pro'::public.producer_tier_type,
    updated_at             = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id',        p_user_id,
    'campaign_type',  p_campaign_type,
    'trial_start',    p_trial_start,
    'trial_end',      p_trial_start + v_campaign.trial_duration,
    'slots_used',     v_slot_count + 1,
    'slots_max',      v_campaign.max_slots
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_assign_producer_campaign(uuid, text, timestamptz)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_assign_producer_campaign(uuid, text, timestamptz)
  FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Backward compat : admin_activate_founding_producer() devient un wrapper
--    Signature identique → aucun changement dans le code existant qui l'appelle
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_activate_founding_producer(
  p_user_id     uuid,
  p_trial_start timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assign_producer_campaign(p_user_id, 'founding', p_trial_start);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_activate_founding_producer(uuid, timestamptz)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_activate_founding_producer(uuid, timestamptz)
  FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. is_founding_trial_active() mis à jour
--    Même signature, même sémantique, mais délègue maintenant à la logique campaign
--    → le producer-checkout Edge Function ne change pas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_founding_trial_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.producer_campaigns pc ON pc.type = up.producer_campaign_type
    WHERE up.id = p_user_id
      AND up.founding_trial_start IS NOT NULL
      AND pc.is_active = true
      AND now() < up.founding_trial_start + pc.trial_duration
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_founding_trial_active(uuid)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Visibilité admin : lister les participants d'une campagne
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_campaign_producers(
  p_campaign_type text
)
RETURNS TABLE (
  user_id        uuid,
  username       text,
  email          text,
  trial_start    timestamptz,
  trial_end      timestamptz,
  trial_active   boolean,
  days_remaining int,
  slot_number    int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    up.id                                                      AS user_id,
    up.username,
    up.email,
    up.founding_trial_start                                    AS trial_start,
    (up.founding_trial_start + pc.trial_duration)              AS trial_end,
    (now() < up.founding_trial_start + pc.trial_duration)      AS trial_active,
    GREATEST(0,
      EXTRACT(DAY FROM (up.founding_trial_start + pc.trial_duration - now()))
    )::int                                                     AS days_remaining,
    ROW_NUMBER() OVER (ORDER BY up.founding_trial_start)::int  AS slot_number
  FROM public.user_profiles up
  JOIN public.producer_campaigns pc ON pc.type = up.producer_campaign_type
  WHERE up.producer_campaign_type = p_campaign_type
  ORDER BY up.founding_trial_start
$$;

-- Seuls les admins peuvent lister les participants
CREATE OR REPLACE FUNCTION public.admin_list_campaign_producers_safe(
  p_campaign_type text
)
RETURNS TABLE (
  user_id        uuid,
  username       text,
  email          text,
  trial_start    timestamptz,
  trial_end      timestamptz,
  trial_active   boolean,
  days_remaining int,
  slot_number    int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT * FROM public.admin_list_campaign_producers(p_campaign_type);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_campaign_producers_safe(text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_campaign_producers_safe(text)
  FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Protection : le trigger existant couvre déjà les colonnes founding.
--     On étend pour couvrir producer_campaign_type également.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_founding_producer_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.is_founding_producer      IS DISTINCT FROM OLD.is_founding_producer
    OR NEW.founding_trial_start   IS DISTINCT FROM OLD.founding_trial_start
    OR NEW.producer_campaign_type IS DISTINCT FROM OLD.producer_campaign_type
  ) THEN
    IF current_setting('role', true) NOT IN ('service_role', 'supabase_admin')
       AND NOT public.is_admin()
    THEN
      RAISE EXCEPTION 'Unauthorized: campaign fields can only be modified by admins'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Le trigger trg_guard_founding_columns est déjà sur user_profiles (migration 221)
-- Il sera automatiquement mis à jour par le CREATE OR REPLACE de la fonction ci-dessus.

COMMIT;
