BEGIN;

CREATE OR REPLACE VIEW public.admin_revenue_breakdown AS
SELECT
  p.id,
  p.created_at,
  ROUND(COALESCE(p.amount, 0)::numeric / 100.0, 2) AS gross_eur,
  ROUND(COALESCE(p.producer_share_cents_snapshot, 0)::numeric / 100.0, 2) AS producer_share_eur,
  ROUND(COALESCE(p.platform_share_cents_snapshot, 0)::numeric / 100.0, 2) AS platform_share_eur,
  p.purchase_source,
  pr.title,
  buyer.email AS buyer_email,
  producer.email AS producer_email
FROM public.purchases p
JOIN public.products pr
  ON pr.id = p.product_id
JOIN public.user_profiles buyer
  ON buyer.id = p.user_id
JOIN public.user_profiles producer
  ON producer.id = pr.producer_id
WHERE (
    public.is_admin(auth.uid())
    OR COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '') = 'service_role'
  )
  AND p.status = 'completed';

GRANT SELECT ON TABLE public.admin_revenue_breakdown TO authenticated;
GRANT SELECT ON TABLE public.admin_revenue_breakdown TO service_role;

COMMIT;
