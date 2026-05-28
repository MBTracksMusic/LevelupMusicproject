-- Storyteller share SQL smoke test.
-- Run against a local Supabase database after migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/storyteller_share.sql

BEGIN;

DO $$
DECLARE
  v_enabled_from timestamptz := now() - interval '1 minute';
  v_winner uuid := gen_random_uuid();
  v_loser uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_voter1 uuid := gen_random_uuid();
  v_voter2 uuid := gen_random_uuid();
  v_voter3 uuid := gen_random_uuid();
  v_winner_product uuid := gen_random_uuid();
  v_loser_product uuid := gen_random_uuid();
  v_battle uuid := gen_random_uuid();
  v_old_battle uuid := gen_random_uuid();
  v_vote1 uuid := gen_random_uuid();
  v_vote2 uuid := gen_random_uuid();
  v_vote3 uuid := gen_random_uuid();
  v_data jsonb;
  v_share1 jsonb;
  v_share2 jsonb;
  v_old_share jsonb;
  v_event_count integer;
BEGIN
  UPDATE public.app_settings
  SET value = jsonb_build_object('enabled_from', v_enabled_from, 'xp', 15)
  WHERE key = 'storyteller_share_config';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_winner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'winner@example.test', 'x', now(), now(), now()),
    (v_loser, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'loser@example.test', 'x', now(), now(), now()),
    (v_outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', 'x', now(), now(), now()),
    (v_voter1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'voter1@example.test', 'x', now(), now(), now()),
    (v_voter2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'voter2@example.test', 'x', now(), now(), now()),
    (v_voter3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'voter3@example.test', 'x', now(), now(), now());

  INSERT INTO public.user_profiles (id, email, username, role, is_producer_active)
  VALUES
    (v_winner, 'winner@example.test', 'winner_sql', 'producer', true),
    (v_loser, 'loser@example.test', 'loser_sql', 'producer', true),
    (v_outsider, 'outsider@example.test', 'outsider_sql', 'producer', true),
    (v_voter1, 'voter1@example.test', 'voter1_sql', 'confirmed_user', false),
    (v_voter2, 'voter2@example.test', 'voter2_sql', 'confirmed_user', false),
    (v_voter3, 'voter3@example.test', 'voter3_sql', 'confirmed_user', false)
  ON CONFLICT (id) DO UPDATE
  SET username = EXCLUDED.username,
      role = EXCLUDED.role,
      is_producer_active = EXCLUDED.is_producer_active;

  INSERT INTO public.products (id, producer_id, title, slug, product_type, price, is_published)
  VALUES
    (v_winner_product, v_winner, 'Winner beat', 'winner-beat-sql', 'beat', 1000, true),
    (v_loser_product, v_loser, 'Challenger beat', 'challenger-beat-sql', 'beat', 1000, true);

  INSERT INTO public.battles (
    id,
    title,
    slug,
    producer1_id,
    producer2_id,
    product1_id,
    product2_id,
    status,
    winner_id,
    votes_producer1,
    votes_producer2,
    created_at
  )
  VALUES
    (
      v_battle,
      'Storyteller SQL battle',
      'storyteller-sql-battle',
      v_winner,
      v_loser,
      v_winner_product,
      v_loser_product,
      'completed',
      v_winner,
      5,
      3,
      now()
    ),
    (
      v_old_battle,
      'Old Storyteller SQL battle',
      'old-storyteller-sql-battle',
      v_winner,
      v_loser,
      v_winner_product,
      v_loser_product,
      'completed',
      v_winner,
      5,
      3,
      v_enabled_from - interval '1 hour'
    );

  INSERT INTO public.battle_votes (id, battle_id, user_id, voted_for_producer_id)
  VALUES
    (v_vote1, v_battle, v_voter1, v_loser),
    (v_vote2, v_battle, v_voter2, v_loser),
    (v_vote3, v_battle, v_voter3, v_loser);

  INSERT INTO public.battle_vote_feedback (vote_id, battle_id, winner_product_id, user_id, criterion)
  VALUES
    (v_vote1, v_battle, v_loser_product, v_voter1, 'mix'),
    (v_vote1, v_battle, v_loser_product, v_voter1, 'groove'),
    (v_vote1, v_battle, v_loser_product, v_voter1, 'energy'),
    (v_vote2, v_battle, v_loser_product, v_voter2, 'mix'),
    (v_vote2, v_battle, v_loser_product, v_voter2, 'groove'),
    (v_vote3, v_battle, v_loser_product, v_voter3, 'mix');

  PERFORM set_config('request.jwt.claim.sub', v_loser::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_data := public.get_loser_share_data(v_battle);
  IF COALESCE((v_data->>'is_loser_role')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected loser role data, got %', v_data;
  END IF;

  IF v_data #>> '{top_traits,0,criterion_key}' <> 'mix' THEN
    RAISE EXCEPTION 'expected top trait mix, got %', v_data->'top_traits';
  END IF;

  v_share1 := public.record_loser_battle_share(v_battle, 'x', 'traits');
  IF COALESCE((v_share1->>'xp_awarded')::boolean, false) IS NOT TRUE
     OR COALESCE((v_share1->>'xp_delta')::integer, 0) <> 15 THEN
    RAISE EXCEPTION 'expected first share to award 15 XP, got %', v_share1;
  END IF;

  v_share2 := public.record_loser_battle_share(v_battle, 'whatsapp', 'comeback');
  IF COALESCE((v_share2->>'xp_awarded')::boolean, false) IS TRUE
     OR COALESCE((v_share2->>'xp_delta')::integer, 0) <> 0 THEN
    RAISE EXCEPTION 'expected duplicate share to award 0 XP, got %', v_share2;
  END IF;

  SELECT count(*)::int
  INTO v_event_count
  FROM public.reputation_events
  WHERE idempotency_key = 'storyteller_share:' || v_battle::text || ':' || v_loser::text;

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'expected one reputation event, got %', v_event_count;
  END IF;

  v_old_share := public.record_loser_battle_share(v_old_battle, 'copy', 'neutral');
  IF COALESCE((v_old_share->>'xp_delta')::integer, 0) <> 0 THEN
    RAISE EXCEPTION 'expected old battle to award 0 XP, got %', v_old_share;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_winner::text, true);
  v_data := public.get_loser_share_data(v_battle);
  IF COALESCE((v_data->>'is_loser_role')::boolean, true) IS TRUE THEN
    RAISE EXCEPTION 'expected winner to be denied loser share data, got %', v_data;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.record_loser_battle_share(v_battle, 'facebook', 'neutral');
    RAISE EXCEPTION 'expected outsider share to fail';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'loser_role_required' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;
