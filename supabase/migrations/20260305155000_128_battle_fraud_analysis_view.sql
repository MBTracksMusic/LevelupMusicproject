/*
  # Create admin battle fraud analysis view
*/

BEGIN;

CREATE OR REPLACE VIEW public.battle_fraud_analysis
WITH (security_invoker = true)
AS
SELECT
  fe.battle_id,
  COUNT(*) FILTER (WHERE fe.event_type = 'battle_vote') AS vote_events,
  COUNT(DISTINCT fe.ip_hash) FILTER (WHERE fe.event_type = 'battle_vote') AS unique_ip_hashes,
  COUNT(DISTINCT fe.ua_hash) FILTER (WHERE fe.event_type = 'battle_vote') AS unique_ua_hashes,
  (
    COUNT(*) FILTER (WHERE fe.event_type = 'battle_vote')
    - COUNT(DISTINCT fe.ip_hash) FILTER (WHERE fe.event_type = 'battle_vote')
  ) AS suspicious_by_ip
FROM public.fraud_events fe
WHERE fe.battle_id IS NOT NULL
GROUP BY fe.battle_id;

REVOKE ALL ON TABLE public.battle_fraud_analysis FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_fraud_analysis FROM anon;
GRANT SELECT ON TABLE public.battle_fraud_analysis TO authenticated;
GRANT SELECT ON TABLE public.battle_fraud_analysis TO service_role;

COMMIT;
