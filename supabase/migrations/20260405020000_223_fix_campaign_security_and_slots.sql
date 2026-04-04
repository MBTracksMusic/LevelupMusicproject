/*
  # Fix: Campaign system security & slot race condition

  ## Corrections
  1. SECURITY: Revoke EXECUTE on admin_list_campaign_producers (email leak)
  2. RACE CONDITION: Add FOR UPDATE lock on producer_campaigns row in slot check
  3. COSMETIC: Initialize v_slot_count to 0 (clean return value)
  4. SAFETY: COALESCE current_setting('role') to avoid NULL bypass in trigger guard

  ## Ce qui ne change PAS
  - La logique métier du campaign system est inchangée
  - La vue my_user_profile est inchangée
  - Le comportement pour Stripe est inchangé
  - Les signatures des fonctions sont inchangées (backward compat)
*/

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SECURITY FIX : révoquer l'accès public à admin_list_campaign_producers
--    La version non-safe exposait les emails de tous les participants.
--    Seule admin_list_campaign_producers_safe (avec is_admin() check) est accessible.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.admin_list_campaign_producers(text)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.admin_list_campaign_producers(text)
  FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_campaign_producers(text)
  FROM anon;

-- Seul le service_role peut l'appeler directement (depuis admin_list_campaign_producers_safe)
GRANT EXECUTE ON FUNCTION public.admin_list_campaign_producers(text)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RACE CONDITION FIX + COSMETIC FIX : recréer admin_assign_producer_campaign
--    Changements :
--    a) SELECT ... FOR UPDATE sur la ligne campaign → sérialise les appels concurrents
--    b) v_slot_count initialisé à 0 → return value propre même pour slots illimités
--    c) Commentaire corrigé sur SECURITY DEFINER vs trigger
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
  v_slot_count   int := 0;  -- initialisé à 0 : retour propre même si max_slots IS NULL
  v_current_role text;
BEGIN
  -- ── Vérification admin ──────────────────────────────────────────────────
  -- Note : is_admin() vérifie auth.uid() (JWT original). Le SECURITY DEFINER
  -- de cette fonction n'altère pas auth.uid(), donc is_admin() fonctionne
  -- correctement — le trigger guard_founding_producer_columns se déclenche
  -- aussi et passe parce que is_admin() = true pour l'appelant.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required'
      USING ERRCODE = '42501';
  END IF;

  -- ── Vérification que la campagne existe et est active
  --    FOR UPDATE : verrouille la ligne pour sérialiser les appels concurrents.
  --    Deux admins qui activent simultanément ne peuvent pas dépasser max_slots.
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

  -- ── Vérification des slots disponibles (atomique grâce au FOR UPDATE ci-dessus)
  IF v_campaign.max_slots IS NOT NULL THEN
    SELECT count(*) INTO v_slot_count
    FROM public.user_profiles
    WHERE producer_campaign_type = p_campaign_type;

    -- Ne pas compter le user lui-même s'il est déjà dans cette campagne (idempotence)
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
    -- max_slots IS NULL (illimité) : récupérer quand même le count pour le return
    SELECT count(*) INTO v_slot_count
    FROM public.user_profiles
    WHERE producer_campaign_type = p_campaign_type;
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
  -- is_producer_active : intentionnellement NON modifié (owned by trg_sync_user_profile_producer)
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
                               WHEN v_current_role = 'admin' THEN 'admin'
                               ELSE 'producer'
                             END,
    producer_tier          = 'pro'::public.producer_tier_type,
    updated_at             = now()
  WHERE id = p_user_id;

  -- v_slot_count reflète le count AVANT cette activation
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
-- 3. SAFETY FIX : trigger guard — COALESCE current_setting pour éviter NULL bypass
--    Sans COALESCE, une connexion directe postgres sans JWT pourrait passer le guard.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_founding_producer_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ce trigger se déclenche pour TOUT UPDATE sur user_profiles, y compris
  -- les appels depuis des fonctions SECURITY DEFINER. Il n'y a pas de bypass
  -- automatique : is_admin() vérifie auth.uid() (JWT original de l'appelant)
  -- et laisse passer si l'appelant est admin.
  IF (
    NEW.is_founding_producer      IS DISTINCT FROM OLD.is_founding_producer
    OR NEW.founding_trial_start   IS DISTINCT FROM OLD.founding_trial_start
    OR NEW.producer_campaign_type IS DISTINCT FROM OLD.producer_campaign_type
  ) THEN
    -- COALESCE : si current_setting retourne NULL (connexion directe postgres sans JWT),
    -- on traite comme chaîne vide → le check porte uniquement sur is_admin()
    IF COALESCE(current_setting('role', true), '') NOT IN ('service_role', 'supabase_admin')
       AND NOT COALESCE(public.is_admin(), false)
    THEN
      RAISE EXCEPTION 'Unauthorized: campaign fields can only be modified by admins'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Le trigger trg_guard_founding_columns est déjà en place sur user_profiles
-- (migration 221). CREATE OR REPLACE de la fonction suffit à le mettre à jour.

COMMIT;
