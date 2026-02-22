/*
  # Rule-based AI moderation for battle comments

  - For every inserted comment, creates ai_admin_actions proposal.
  - Auto-hides toxic/spam comments when score >= 0.95.
  - Keeps existing battle_comments flow unchanged.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.classify_battle_comment_rule_based(p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_text text := lower(COALESCE(p_content, ''));
  v_toxic_hits integer := 0;
  v_spam_hits integer := 0;
  v_borderline_hits integer := 0;
  v_has_link boolean := false;
  v_classification text := 'safe';
  v_score numeric(5,4) := 0.0500;
  v_reason text := 'no_signal';
  v_suggested_action text := 'allow';
BEGIN
  IF btrim(v_text) = '' THEN
    v_classification := 'spam';
    v_score := 0.9900;
    v_reason := 'empty_comment';
    v_suggested_action := 'hide';
  ELSE
    v_has_link := (v_text ~ '(https?://|www\\.)');

    SELECT COUNT(*) INTO v_toxic_hits
    FROM unnest(ARRAY[
      'kill yourself', 'kys', 'nazi', 'racist', 'slur', 'fdp', 'pute', 'connard', 'encule'
    ]) kw
    WHERE v_text LIKE '%' || kw || '%';

    SELECT COUNT(*) INTO v_spam_hits
    FROM unnest(ARRAY[
      'buy followers', 'free money', 'dm me', 'telegram', 'whatsapp', 'crypto giveaway', 'promo code'
    ]) kw
    WHERE v_text LIKE '%' || kw || '%';

    SELECT COUNT(*) INTO v_borderline_hits
    FROM unnest(ARRAY[
      'nul', 'naze', 'trash', 'horrible', 'hate', 'stupid', 'idiot'
    ]) kw
    WHERE v_text LIKE '%' || kw || '%';

    IF v_toxic_hits > 0 THEN
      v_classification := 'toxic';
      v_score := LEAST(1.0000, 0.9400 + (v_toxic_hits * 0.0300));
      v_reason := 'toxic_keyword_match';
      v_suggested_action := CASE WHEN v_score >= 0.9500 THEN 'hide' ELSE 'review' END;
    ELSIF v_spam_hits > 0 OR (v_has_link AND char_length(v_text) <= 40) THEN
      v_classification := 'spam';
      v_score := CASE
        WHEN v_spam_hits > 1 OR (v_has_link AND char_length(v_text) <= 20) THEN 0.9700
        ELSE 0.9100
      END;
      v_reason := 'spam_signal_match';
      v_suggested_action := CASE WHEN v_score >= 0.9500 THEN 'hide' ELSE 'review' END;
    ELSIF v_borderline_hits > 0 THEN
      v_classification := 'borderline';
      v_score := LEAST(0.8900, 0.6200 + (v_borderline_hits * 0.0700));
      v_reason := 'borderline_toxicity_signal';
      v_suggested_action := 'review';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'model', 'rule-based-comment-v1',
    'classification', v_classification,
    'score', v_score,
    'reason', v_reason,
    'suggested_action', v_suggested_action,
    'flags', jsonb_build_object(
      'toxic_hits', v_toxic_hits,
      'spam_hits', v_spam_hits,
      'borderline_hits', v_borderline_hits,
      'has_link', v_has_link
    ),
    'auto_threshold', 0.9500,
    'analyzed_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_ai_comment_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_decision jsonb;
  v_score numeric(5,4);
  v_classification text;
  v_action_id uuid;
BEGIN
  v_decision := public.classify_battle_comment_rule_based(NEW.content);
  v_score := COALESCE((v_decision->>'score')::numeric, 0.0000);
  v_classification := COALESCE(v_decision->>'classification', 'safe');

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    human_override,
    reversible,
    executed_at,
    executed_by,
    error
  ) VALUES (
    'comment_moderation',
    'comment',
    NEW.id,
    v_decision,
    v_score,
    COALESCE(v_decision->>'reason', 'rule_based_scan'),
    'proposed',
    false,
    true,
    NULL,
    NULL,
    NULL
  ) RETURNING id INTO v_action_id;

  IF v_classification IN ('toxic', 'spam') AND v_score >= 0.9500 THEN
    UPDATE public.battle_comments
    SET is_hidden = true,
        hidden_reason = 'auto_moderated'
    WHERE id = NEW.id
      AND is_hidden = false;

    UPDATE public.ai_admin_actions
    SET status = 'executed',
        reason = 'Auto-moderated by rule-based policy.',
        executed_at = now(),
        ai_decision = ai_decision || jsonb_build_object(
          'applied_action', 'hide',
          'applied_hidden_reason', 'auto_moderated'
        )
    WHERE id = v_action_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_process_ai_comment_moderation ON public.battle_comments;

CREATE TRIGGER trg_process_ai_comment_moderation
  AFTER INSERT ON public.battle_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.process_ai_comment_moderation();

REVOKE EXECUTE ON FUNCTION public.classify_battle_comment_rule_based(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.classify_battle_comment_rule_based(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.classify_battle_comment_rule_based(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.classify_battle_comment_rule_based(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_ai_comment_moderation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_ai_comment_moderation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_ai_comment_moderation() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_ai_comment_moderation() TO service_role;

COMMIT;
