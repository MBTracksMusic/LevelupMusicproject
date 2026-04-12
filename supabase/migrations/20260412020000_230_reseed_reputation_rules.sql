/*
  # Fix: re-seed reputation_rules (table vide → finalize_battle crashe)

  Problème:
  - La table reputation_rules est vide en base.
  - Le trigger on_battle_completed_reputation appelle apply_reputation_event_internal
    avec p_delta = NULL pour 'battle_participation' et 'battle_won'.
  - La fonction lit la règle dans reputation_rules. Sans règle trouvée + p_delta NULL
    → RAISE EXCEPTION 'reputation_rule_not_found'.
  - Ce crash se propage jusqu'à finalize_battle → rollback complet.
  - Résultat: impossible de clôturer une battle.

  Fix:
  - Ré-insérer les 8 règles originales de la migration 102 (ON CONFLICT DO UPDATE
    pour idempotence).
*/

BEGIN;

INSERT INTO public.reputation_rules (key, source, event_type, delta_xp, cooldown_sec, max_per_day, is_enabled)
VALUES
  ('forum_topic_created',  'forum',   'forum_topic_created',  10,   15,  50,   true),
  ('forum_post_created',   'forum',   'forum_post_created',    4,   10,  120,  true),
  ('forum_post_liked',     'forum',   'forum_post_liked',      2,    0,  200,  true),
  ('battle_won',           'battles', 'battle_won',           50,    0,  NULL, true),
  ('battle_participation', 'battles', 'battle_participation',  10,   0,  NULL, true),
  ('moderation_blocked',   'forum',   'moderation_blocked',  -20,   0,  NULL, true),
  ('moderation_review',    'forum',   'moderation_review',    -5,   0,  NULL, true),
  ('admin_adjustment',     'admin',   'admin_adjustment',      0,   0,  NULL, true)
ON CONFLICT (key) DO UPDATE
SET source       = EXCLUDED.source,
    event_type   = EXCLUDED.event_type,
    delta_xp     = EXCLUDED.delta_xp,
    cooldown_sec = EXCLUDED.cooldown_sec,
    max_per_day  = EXCLUDED.max_per_day,
    is_enabled   = EXCLUDED.is_enabled,
    updated_at   = now();

COMMIT;
