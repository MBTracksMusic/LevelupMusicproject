/*
  # Founding Producer Trial System

  ## Objectif
  Système de trial gratuit 3 mois pour les "Founding Producers", activé manuellement
  par un admin, sans aucune interaction Stripe pendant la période de trial.

  ## Règles métier
  - is_producer_active = owned by Stripe trigger (trg_sync_user_profile_producer) → NE PAS TOUCHER
  - is_founding_producer + founding_trial_start = source de vérité du trial
  - can_access_producer_features = calculé dans la vue (Stripe OU trial actif)
  - founding_trial_expired = calculé dans la vue (trial expiré ET pas de Stripe actif)

  ## Tables modifiées
  - user_profiles : 2 nouvelles colonnes
  - my_user_profile (vue) : 5 nouveaux champs calculés

  ## Fonctions ajoutées
  - admin_activate_founding_producer(p_user_id, p_trial_start)
  - is_founding_trial_active(p_user_id) — pour producer-checkout Edge Function
*/

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Nouvelles colonnes dans user_profiles
--    NE PAS modifier is_producer_active — owned by trigger Stripe (migration 216)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_founding_producer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_trial_start  timestamptz NULL;

-- Index pour les queries admin (liste des founding producers)
CREATE INDEX IF NOT EXISTS idx_user_profiles_founding
  ON public.user_profiles (is_founding_producer, founding_trial_start)
  WHERE is_founding_producer = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Contrainte d'intégrité : founding_trial_start requis si is_founding_producer
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS chk_founding_trial_coherence;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT chk_founding_trial_coherence
  CHECK (
    (is_founding_producer = false)
    OR (is_founding_producer = true AND founding_trial_start IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Vue my_user_profile enrichie
--    Reproduit exactement l'état actuel (migration 20260330170946_remote_schema.sql)
--    et ajoute les 5 champs founding calculés en SQL pur (interval '3 months')
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

  -- ── Founding Producer fields ──────────────────────────────────────────────

  up.is_founding_producer,
  up.founding_trial_start,

  -- Fin calculée du trial (jamais NULL si is_founding_producer = true)
  CASE
    WHEN up.founding_trial_start IS NOT NULL
    THEN up.founding_trial_start + interval '3 months'
    ELSE NULL
  END                           AS founding_trial_end,

  -- Trial encore actif : founding + start défini + dans la fenêtre de 3 mois
  (
    up.is_founding_producer = true
    AND up.founding_trial_start IS NOT NULL
    AND now() < up.founding_trial_start + interval '3 months'
  )                             AS founding_trial_active,

  -- Trial expiré ET pas de Stripe actif → déclenche le paywall
  (
    up.is_founding_producer = true
    AND up.founding_trial_start IS NOT NULL
    AND now() >= up.founding_trial_start + interval '3 months'
    AND up.is_producer_active = false
  )                             AS founding_trial_expired,

  -- Source de vérité pour les permissions producteur (Stripe OU trial actif)
  -- C'est CE champ que le frontend doit utiliser, pas is_producer_active seul
  (
    up.is_producer_active = true
    OR (
      up.is_founding_producer = true
      AND up.founding_trial_start IS NOT NULL
      AND now() < up.founding_trial_start + interval '3 months'
    )
  )                             AS can_access_producer_features

FROM public.user_profiles up
WHERE up.id = auth.uid();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC admin : activer un Founding Producer
--    - Ne touche PAS is_producer_active (owned by Stripe trigger)
--    - Définit role = 'producer' pour la navigation
--    - Définit producer_tier = 'pro' pour les quotas
--    - Définit is_founding_producer = true + founding_trial_start
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_activate_founding_producer(
  p_user_id    uuid,
  p_trial_start timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Seul un admin peut appeler cette fonction
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required' USING ERRCODE = '42501';
  END IF;

  -- Interdire une activation si le user a déjà un trial en cours
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_user_id
      AND is_founding_producer = true
      AND founding_trial_start IS NOT NULL
      AND now() < founding_trial_start + interval '3 months'
  ) THEN
    RAISE EXCEPTION 'User % already has an active founding trial', p_user_id
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.user_profiles
  SET
    is_founding_producer = true,
    founding_trial_start = p_trial_start,
    -- Donner le rôle producteur pour la navigation frontend
    role                 = CASE
                             WHEN role = 'admin' THEN role  -- ne pas dégrader un admin
                             ELSE 'producer'
                           END,
    -- Tier pro pendant le trial (quotas illimités comme un vrai producteur pro)
    producer_tier        = 'pro'::public.producer_tier_type,
    -- is_producer_active intentionnellement non modifié : owned by Stripe trigger
    updated_at           = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id
      USING ERRCODE = '02000';
  END IF;
END;
$$;

-- Seuls les utilisateurs authentifiés peuvent l'appeler (is_admin() vérifié dedans)
GRANT EXECUTE ON FUNCTION public.admin_activate_founding_producer(uuid, timestamptz)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_activate_founding_producer(uuid, timestamptz)
  FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC helper pour producer-checkout Edge Function
--    Permet au service_role de vérifier le statut trial côté DB (pas de JS date math)
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
    FROM public.user_profiles
    WHERE id = p_user_id
      AND is_founding_producer = true
      AND founding_trial_start IS NOT NULL
      AND now() < founding_trial_start + interval '3 months'
  );
$$;

-- Accessible en service_role uniquement (appelé depuis l'Edge Function)
GRANT EXECUTE ON FUNCTION public.is_founding_trial_active(uuid)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS : protection des colonnes founding contre toute auto-modification
--    La politique UPDATE existante sur user_profiles doit exclure ces colonnes.
--    Si la politique actuelle utilise une colonne list, on n'a rien à faire car
--    les nouvelles colonnes ne seront pas dans la liste. Sinon, on ajoute un trigger
--    de protection.
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger : empêche tout utilisateur (y compris lui-même) de modifier
-- is_founding_producer ou founding_trial_start via une mise à jour directe.
-- Seul admin_activate_founding_producer (SECURITY DEFINER) peut le faire.

CREATE OR REPLACE FUNCTION public.guard_founding_producer_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bloquer si un user normal tente de modifier les colonnes founding
  -- (les fonctions SECURITY DEFINER bypassent ce trigger car elles s'exécutent
  -- avec les droits de leur owner, pas de l'appelant)
  IF (
    NEW.is_founding_producer IS DISTINCT FROM OLD.is_founding_producer
    OR NEW.founding_trial_start IS DISTINCT FROM OLD.founding_trial_start
  ) THEN
    -- Autoriser seulement si appelé en service_role ou par is_admin()
    IF current_setting('role', true) NOT IN ('service_role', 'supabase_admin')
       AND NOT public.is_admin()
    THEN
      RAISE EXCEPTION 'Unauthorized: cannot modify founding producer fields'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_founding_columns ON public.user_profiles;

CREATE TRIGGER trg_guard_founding_columns
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_founding_producer_columns();

COMMIT;
