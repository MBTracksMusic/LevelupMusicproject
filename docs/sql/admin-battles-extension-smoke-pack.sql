-- Admin Battles Extension Control Pack (Dry-Run)
--
-- Goal:
-- - Validate admin_extend_battle_duration in a reproducible way
-- - Keep tests in one SQL Editor RUN
-- - Avoid durable data changes (BEGIN ... ROLLBACK)
--
-- Notes:
-- - This pack sets request.jwt.claim.sub and request.jwt.claim.role in-transaction.
-- - If no admin user exists, tests are marked SKIPPED/FAIL accordingly.

BEGIN;

-- -----------------------------------------------------------------------------
-- Sanity checks BEFORE set_config (expected to often be NULL/FALSE in SQL Editor)
-- -----------------------------------------------------------------------------
SELECT auth.uid() AS uid;
SELECT public.is_admin(auth.uid()) AS is_admin;

CREATE TEMP TABLE _smoke_results (
  test_name text NOT NULL,
  status text NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE _smoke_ctx (
  rpc_exists boolean,
  admin_uid uuid,
  candidate_battle_id uuid,
  baseline_status text,
  baseline_voting_ends_at timestamptz,
  baseline_starts_at timestamptz,
  baseline_extension_count integer,
  has_extension_count boolean,
  action_type_check_has_battle_duration_extended boolean
);

DO $$
DECLARE
  v_rpc_exists boolean;
  v_admin_uid uuid;
  v_candidate_id uuid;
  v_baseline_status text;
  v_baseline_voting_ends_at timestamptz;
  v_baseline_starts_at timestamptz;
  v_baseline_extension_count integer := NULL;
  v_has_extension_count boolean;
  v_has_action_type_value boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'admin_extend_battle_duration'
  ) INTO v_rpc_exists;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'battles'
      AND column_name = 'extension_count'
  ) INTO v_has_extension_count;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'ai_admin_actions'
      AND c.conname = 'ai_admin_actions_action_type_check'
      AND pg_get_constraintdef(c.oid) ILIKE '%battle_duration_extended%'
  ) INTO v_has_action_type_value;

  SELECT up.id
  INTO v_admin_uid
  FROM public.user_profiles up
  WHERE up.role = 'admin'
  ORDER BY up.created_at NULLS LAST, up.id
  LIMIT 1;

  IF v_admin_uid IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  END IF;

  SELECT b.id, b.status::text, b.voting_ends_at, b.starts_at
  INTO v_candidate_id, v_baseline_status, v_baseline_voting_ends_at, v_baseline_starts_at
  FROM public.battles b
  WHERE b.status IN ('active', 'voting')
    AND b.voting_ends_at IS NOT NULL
  ORDER BY b.voting_ends_at ASC
  LIMIT 1;

  IF v_has_extension_count AND v_candidate_id IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(extension_count, 0) FROM public.battles WHERE id = $1'
      INTO v_baseline_extension_count
      USING v_candidate_id;
  END IF;

  INSERT INTO _smoke_ctx (
    rpc_exists,
    admin_uid,
    candidate_battle_id,
    baseline_status,
    baseline_voting_ends_at,
    baseline_starts_at,
    baseline_extension_count,
    has_extension_count,
    action_type_check_has_battle_duration_extended
  )
  VALUES (
    v_rpc_exists,
    v_admin_uid,
    v_candidate_id,
    v_baseline_status,
    v_baseline_voting_ends_at,
    v_baseline_starts_at,
    v_baseline_extension_count,
    v_has_extension_count,
    v_has_action_type_value
  );

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES (
    'sanity.rpc_presence',
    CASE WHEN v_rpc_exists THEN 'PASS' ELSE 'FAIL' END,
    CASE
      WHEN v_rpc_exists THEN 'public.admin_extend_battle_duration found.'
      ELSE 'public.admin_extend_battle_duration not found. Skipping RPC tests.'
    END
  );

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES (
    'sanity.action_type_check_contains_battle_duration_extended',
    CASE WHEN v_has_action_type_value THEN 'PASS' ELSE 'WARN' END,
    CASE
      WHEN v_has_action_type_value THEN 'ai_admin_actions_action_type_check contains battle_duration_extended.'
      ELSE 'CHECK does not include battle_duration_extended. Extension log insert may fail.'
    END
  );

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES (
    'sanity.admin_context',
    CASE
      WHEN v_admin_uid IS NULL THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE
      WHEN v_admin_uid IS NULL THEN 'No admin user found in public.user_profiles.'
      ELSE 'Admin uid injected via set_config: ' || v_admin_uid::text
    END
  );

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES (
    'sanity.candidate_battle',
    CASE
      WHEN v_candidate_id IS NULL THEN 'SKIPPED'
      ELSE 'PASS'
    END,
    CASE
      WHEN v_candidate_id IS NULL THEN 'No candidate battle with status active/voting and voting_ends_at not null.'
      ELSE 'Candidate battle id: ' || v_candidate_id::text
    END
  );
END
$$;

-- -----------------------------------------------------------------------------
-- Sanity checks AFTER set_config (must be in same RUN as RPC calls)
-- -----------------------------------------------------------------------------
SELECT current_setting('request.jwt.claim.sub', true) AS jwt_sub;
SELECT auth.uid() AS uid;
SELECT public.is_admin(auth.uid()) AS is_admin;

-- -----------------------------------------------------------------------------
-- Core test: valid extension (+1 day) => end date increases + ai log inserted
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  c _smoke_ctx%ROWTYPE;
  v_before_end timestamptz;
  v_after_end timestamptz;
  v_before_log_count integer;
  v_after_log_count integer;
  v_before_extension_count integer := NULL;
  v_after_extension_count integer := NULL;
  v_ok boolean := false;
  v_pass boolean := false;
  v_details text := '';
BEGIN
  SELECT * INTO c FROM _smoke_ctx LIMIT 1;

  IF c.rpc_exists IS DISTINCT FROM true THEN
    INSERT INTO _smoke_results VALUES ('core.extend_plus_1_day_updates_end_and_log', 'SKIPPED', 'RPC missing.');
    RETURN;
  END IF;

  IF c.admin_uid IS NULL THEN
    INSERT INTO _smoke_results VALUES ('core.extend_plus_1_day_updates_end_and_log', 'SKIPPED', 'Admin uid missing.');
    RETURN;
  END IF;

  IF c.candidate_battle_id IS NULL THEN
    INSERT INTO _smoke_results VALUES ('core.extend_plus_1_day_updates_end_and_log', 'SKIPPED', 'No candidate battle.');
    RETURN;
  END IF;

  SELECT b.voting_ends_at INTO v_before_end
  FROM public.battles b
  WHERE b.id = c.candidate_battle_id;

  SELECT COUNT(*) INTO v_before_log_count
  FROM public.ai_admin_actions a
  WHERE a.entity_type = 'battle'
    AND a.entity_id = c.candidate_battle_id
    AND a.action_type = 'battle_duration_extended';

  IF c.has_extension_count THEN
    EXECUTE 'SELECT COALESCE(extension_count, 0) FROM public.battles WHERE id = $1'
      INTO v_before_extension_count
      USING c.candidate_battle_id;
  END IF;

  BEGIN
    v_ok := public.admin_extend_battle_duration(c.candidate_battle_id, 1, 'smoke_valid_plus_1_day');

    SELECT b.voting_ends_at INTO v_after_end
    FROM public.battles b
    WHERE b.id = c.candidate_battle_id;

    SELECT COUNT(*) INTO v_after_log_count
    FROM public.ai_admin_actions a
    WHERE a.entity_type = 'battle'
      AND a.entity_id = c.candidate_battle_id
      AND a.action_type = 'battle_duration_extended';

    v_pass := (v_ok IS TRUE)
      AND (v_after_end = (v_before_end + interval '1 day'))
      AND (v_after_log_count = v_before_log_count + 1);

    IF c.has_extension_count THEN
      EXECUTE 'SELECT COALESCE(extension_count, 0) FROM public.battles WHERE id = $1'
        INTO v_after_extension_count
        USING c.candidate_battle_id;

      v_pass := v_pass AND (v_after_extension_count = COALESCE(v_before_extension_count, 0) + 1);
    END IF;

    v_details := format(
      'ok=%s, before_end=%s, after_end=%s, log_before=%s, log_after=%s, ext_before=%s, ext_after=%s',
      v_ok,
      COALESCE(v_before_end::text, 'null'),
      COALESCE(v_after_end::text, 'null'),
      v_before_log_count,
      v_after_log_count,
      COALESCE(v_before_extension_count::text, 'n/a'),
      COALESCE(v_after_extension_count::text, 'n/a')
    );
  EXCEPTION WHEN OTHERS THEN
    v_pass := false;
    v_details := 'ERROR: ' || SQLERRM;
  END;

  -- Restore candidate baseline state for next tests.
  IF c.has_extension_count THEN
    EXECUTE
      'UPDATE public.battles
       SET status = $1::public.battle_status,
           voting_ends_at = $2,
           starts_at = $3,
           extension_count = $4
       WHERE id = $5'
    USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, COALESCE(c.baseline_extension_count, 0), c.candidate_battle_id;
  ELSE
    EXECUTE
      'UPDATE public.battles
       SET status = $1::public.battle_status,
           voting_ends_at = $2,
           starts_at = $3
       WHERE id = $4'
    USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, c.candidate_battle_id;
  END IF;

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES (
    'core.extend_plus_1_day_updates_end_and_log',
    CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END,
    v_details
  );
END
$$;

-- -----------------------------------------------------------------------------
-- Error tests required in all cases
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  c _smoke_ctx%ROWTYPE;
  v_pass boolean := false;
  v_details text := '';
BEGIN
  SELECT * INTO c FROM _smoke_ctx LIMIT 1;

  IF c.rpc_exists IS DISTINCT FROM true OR c.admin_uid IS NULL OR c.candidate_battle_id IS NULL THEN
    INSERT INTO _smoke_results VALUES ('core.invalid_extension_days_error', 'SKIPPED', 'Missing RPC/admin/candidate.');
    RETURN;
  END IF;

  BEGIN
    PERFORM public.admin_extend_battle_duration(c.candidate_battle_id, 0, 'smoke_invalid_days');
    v_pass := false;
    v_details := 'Expected invalid_extension_days but call succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_pass := position('invalid_extension_days' in SQLERRM) > 0;
    v_details := CASE
      WHEN v_pass THEN 'Got expected error: invalid_extension_days'
      ELSE 'Unexpected error: ' || SQLERRM
    END;
  END;

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES ('core.invalid_extension_days_error', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, v_details);
END
$$;

DO $$
DECLARE
  c _smoke_ctx%ROWTYPE;
  v_pass boolean := false;
  v_details text := '';
BEGIN
  SELECT * INTO c FROM _smoke_ctx LIMIT 1;

  IF c.rpc_exists IS DISTINCT FROM true OR c.admin_uid IS NULL OR c.candidate_battle_id IS NULL THEN
    INSERT INTO _smoke_results VALUES ('core.battle_not_open_for_extension_error', 'SKIPPED', 'Missing RPC/admin/candidate.');
    RETURN;
  END IF;

  EXECUTE
    'UPDATE public.battles
     SET status = ''completed''::public.battle_status
     WHERE id = $1'
  USING c.candidate_battle_id;

  BEGIN
    PERFORM public.admin_extend_battle_duration(c.candidate_battle_id, 1, 'smoke_not_open');
    v_pass := false;
    v_details := 'Expected battle_not_open_for_extension but call succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_pass := position('battle_not_open_for_extension' in SQLERRM) > 0;
    v_details := CASE
      WHEN v_pass THEN 'Got expected error: battle_not_open_for_extension'
      ELSE 'Unexpected error: ' || SQLERRM
    END;
  END;

  IF c.has_extension_count THEN
    EXECUTE
      'UPDATE public.battles
       SET status = $1::public.battle_status,
           voting_ends_at = $2,
           starts_at = $3,
           extension_count = $4
       WHERE id = $5'
    USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, COALESCE(c.baseline_extension_count, 0), c.candidate_battle_id;
  ELSE
    EXECUTE
      'UPDATE public.battles
       SET status = $1::public.battle_status,
           voting_ends_at = $2,
           starts_at = $3
       WHERE id = $4'
    USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, c.candidate_battle_id;
  END IF;

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES ('core.battle_not_open_for_extension_error', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, v_details);
END
$$;

DO $$
DECLARE
  c _smoke_ctx%ROWTYPE;
  v_pass boolean := false;
  v_details text := '';
BEGIN
  SELECT * INTO c FROM _smoke_ctx LIMIT 1;

  IF c.rpc_exists IS DISTINCT FROM true OR c.admin_uid IS NULL OR c.candidate_battle_id IS NULL THEN
    INSERT INTO _smoke_results VALUES ('core.battle_has_no_voting_end_error', 'SKIPPED', 'Missing RPC/admin/candidate.');
    RETURN;
  END IF;

  EXECUTE
    'UPDATE public.battles
     SET status = ''active''::public.battle_status,
         voting_ends_at = NULL
     WHERE id = $1'
  USING c.candidate_battle_id;

  BEGIN
    PERFORM public.admin_extend_battle_duration(c.candidate_battle_id, 1, 'smoke_no_voting_end');
    v_pass := false;
    v_details := 'Expected battle_has_no_voting_end but call succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_pass := position('battle_has_no_voting_end' in SQLERRM) > 0;
    v_details := CASE
      WHEN v_pass THEN 'Got expected error: battle_has_no_voting_end'
      ELSE 'Unexpected error: ' || SQLERRM
    END;
  END;

  IF c.has_extension_count THEN
    EXECUTE
      'UPDATE public.battles
       SET status = $1::public.battle_status,
           voting_ends_at = $2,
           starts_at = $3,
           extension_count = $4
       WHERE id = $5'
    USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, COALESCE(c.baseline_extension_count, 0), c.candidate_battle_id;
  ELSE
    EXECUTE
      'UPDATE public.battles
       SET status = $1::public.battle_status,
           voting_ends_at = $2,
           starts_at = $3
       WHERE id = $4'
    USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, c.candidate_battle_id;
  END IF;

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES ('core.battle_has_no_voting_end_error', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, v_details);
END
$$;

-- -----------------------------------------------------------------------------
-- Limits pack (optional, only if battles.extension_count exists)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  c _smoke_ctx%ROWTYPE;
  v_pass boolean := false;
  v_details text := '';
  v_before integer;
  v_after integer;
BEGIN
  SELECT * INTO c FROM _smoke_ctx LIMIT 1;

  IF c.has_extension_count IS DISTINCT FROM true THEN
    INSERT INTO _smoke_results VALUES ('limits.extension_count_increment', 'SKIPPED', 'battles.extension_count missing.');
    RETURN;
  END IF;

  IF c.rpc_exists IS DISTINCT FROM true OR c.admin_uid IS NULL OR c.candidate_battle_id IS NULL THEN
    INSERT INTO _smoke_results VALUES ('limits.extension_count_increment', 'SKIPPED', 'Missing RPC/admin/candidate.');
    RETURN;
  END IF;

  EXECUTE
    'UPDATE public.battles
     SET status = ''active''::public.battle_status,
         starts_at = now() - interval ''1 day'',
         voting_ends_at = now() + interval ''2 day'',
         extension_count = 0
     WHERE id = $1'
  USING c.candidate_battle_id;

  EXECUTE 'SELECT COALESCE(extension_count, 0) FROM public.battles WHERE id = $1'
    INTO v_before
    USING c.candidate_battle_id;

  BEGIN
    PERFORM public.admin_extend_battle_duration(c.candidate_battle_id, 1, 'smoke_extension_count_increment');
    EXECUTE 'SELECT COALESCE(extension_count, 0) FROM public.battles WHERE id = $1'
      INTO v_after
      USING c.candidate_battle_id;

    v_pass := (v_after = v_before + 1);
    v_details := format('before=%s, after=%s', v_before, v_after);
  EXCEPTION WHEN OTHERS THEN
    v_pass := false;
    v_details := 'ERROR: ' || SQLERRM;
  END;

  EXECUTE
    'UPDATE public.battles
     SET status = $1::public.battle_status,
         voting_ends_at = $2,
         starts_at = $3,
         extension_count = $4
     WHERE id = $5'
  USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, COALESCE(c.baseline_extension_count, 0), c.candidate_battle_id;

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES ('limits.extension_count_increment', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, v_details);
END
$$;

DO $$
DECLARE
  c _smoke_ctx%ROWTYPE;
  v_pass boolean := false;
  v_details text := '';
BEGIN
  SELECT * INTO c FROM _smoke_ctx LIMIT 1;

  IF c.has_extension_count IS DISTINCT FROM true THEN
    INSERT INTO _smoke_results VALUES ('limits.maximum_extensions_reached_error', 'SKIPPED', 'battles.extension_count missing.');
    RETURN;
  END IF;

  IF c.rpc_exists IS DISTINCT FROM true OR c.admin_uid IS NULL OR c.candidate_battle_id IS NULL THEN
    INSERT INTO _smoke_results VALUES ('limits.maximum_extensions_reached_error', 'SKIPPED', 'Missing RPC/admin/candidate.');
    RETURN;
  END IF;

  EXECUTE
    'UPDATE public.battles
     SET status = ''active''::public.battle_status,
         starts_at = now() - interval ''1 day'',
         voting_ends_at = now() + interval ''2 day'',
         extension_count = 5
     WHERE id = $1'
  USING c.candidate_battle_id;

  BEGIN
    PERFORM public.admin_extend_battle_duration(c.candidate_battle_id, 1, 'smoke_max_extensions');
    v_pass := false;
    v_details := 'Expected maximum_extensions_reached but call succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_pass := position('maximum_extensions_reached' in SQLERRM) > 0;
    v_details := CASE
      WHEN v_pass THEN 'Got expected error: maximum_extensions_reached'
      ELSE 'Unexpected error: ' || SQLERRM
    END;
  END;

  EXECUTE
    'UPDATE public.battles
     SET status = $1::public.battle_status,
         voting_ends_at = $2,
         starts_at = $3,
         extension_count = $4
     WHERE id = $5'
  USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, COALESCE(c.baseline_extension_count, 0), c.candidate_battle_id;

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES ('limits.maximum_extensions_reached_error', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, v_details);
END
$$;

DO $$
DECLARE
  c _smoke_ctx%ROWTYPE;
  v_pass boolean := false;
  v_details text := '';
BEGIN
  SELECT * INTO c FROM _smoke_ctx LIMIT 1;

  IF c.has_extension_count IS DISTINCT FROM true THEN
    INSERT INTO _smoke_results VALUES ('limits.battle_extension_limit_exceeded_error', 'SKIPPED', 'battles.extension_count missing.');
    RETURN;
  END IF;

  IF c.rpc_exists IS DISTINCT FROM true OR c.admin_uid IS NULL OR c.candidate_battle_id IS NULL THEN
    INSERT INTO _smoke_results VALUES ('limits.battle_extension_limit_exceeded_error', 'SKIPPED', 'Missing RPC/admin/candidate.');
    RETURN;
  END IF;

  EXECUTE
    'UPDATE public.battles
     SET status = ''active''::public.battle_status,
         starts_at = now() - interval ''59 day'',
         voting_ends_at = now() + interval ''12 hour'',
         extension_count = 0
     WHERE id = $1'
  USING c.candidate_battle_id;

  BEGIN
    PERFORM public.admin_extend_battle_duration(c.candidate_battle_id, 2, 'smoke_limit_60_days');
    v_pass := false;
    v_details := 'Expected battle_extension_limit_exceeded but call succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_pass := position('battle_extension_limit_exceeded' in SQLERRM) > 0;
    v_details := CASE
      WHEN v_pass THEN 'Got expected error: battle_extension_limit_exceeded'
      ELSE 'Unexpected error: ' || SQLERRM
    END;
  END;

  EXECUTE
    'UPDATE public.battles
     SET status = $1::public.battle_status,
         voting_ends_at = $2,
         starts_at = $3,
         extension_count = $4
     WHERE id = $5'
  USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, COALESCE(c.baseline_extension_count, 0), c.candidate_battle_id;

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES ('limits.battle_extension_limit_exceeded_error', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, v_details);
END
$$;

DO $$
DECLARE
  c _smoke_ctx%ROWTYPE;
  v_pass boolean := false;
  v_details text := '';
BEGIN
  SELECT * INTO c FROM _smoke_ctx LIMIT 1;

  IF c.has_extension_count IS DISTINCT FROM true THEN
    INSERT INTO _smoke_results VALUES ('limits.battle_already_expired_error', 'SKIPPED', 'battles.extension_count missing.');
    RETURN;
  END IF;

  IF c.rpc_exists IS DISTINCT FROM true OR c.admin_uid IS NULL OR c.candidate_battle_id IS NULL THEN
    INSERT INTO _smoke_results VALUES ('limits.battle_already_expired_error', 'SKIPPED', 'Missing RPC/admin/candidate.');
    RETURN;
  END IF;

  EXECUTE
    'UPDATE public.battles
     SET status = ''active''::public.battle_status,
         starts_at = now() - interval ''1 day'',
         voting_ends_at = now() - interval ''1 minute'',
         extension_count = 0
     WHERE id = $1'
  USING c.candidate_battle_id;

  BEGIN
    PERFORM public.admin_extend_battle_duration(c.candidate_battle_id, 1, 'smoke_expired');
    v_pass := false;
    v_details := 'Expected battle_already_expired but call succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_pass := position('battle_already_expired' in SQLERRM) > 0;
    v_details := CASE
      WHEN v_pass THEN 'Got expected error: battle_already_expired'
      ELSE 'Unexpected error: ' || SQLERRM
    END;
  END;

  EXECUTE
    'UPDATE public.battles
     SET status = $1::public.battle_status,
         voting_ends_at = $2,
         starts_at = $3,
         extension_count = $4
     WHERE id = $5'
  USING c.baseline_status, c.baseline_voting_ends_at, c.baseline_starts_at, COALESCE(c.baseline_extension_count, 0), c.candidate_battle_id;

  INSERT INTO _smoke_results(test_name, status, details)
  VALUES ('limits.battle_already_expired_error', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, v_details);
END
$$;

-- -----------------------------------------------------------------------------
-- Final verification output (before rollback)
-- -----------------------------------------------------------------------------
SELECT *
FROM _smoke_ctx;

SELECT
  test_name,
  status,
  details,
  created_at
FROM _smoke_results
ORDER BY created_at, test_name;

SELECT
  b.id,
  b.status,
  b.starts_at,
  b.voting_ends_at
FROM public.battles b
JOIN _smoke_ctx c ON c.candidate_battle_id = b.id;

SELECT
  a.id,
  a.action_type,
  a.status,
  a.executed_at,
  a.executed_by,
  a.ai_decision
FROM public.ai_admin_actions a
JOIN _smoke_ctx c ON c.candidate_battle_id = a.entity_id
WHERE a.entity_type = 'battle'
  AND a.action_type = 'battle_duration_extended'
ORDER BY a.created_at DESC
LIMIT 5;

ROLLBACK;
