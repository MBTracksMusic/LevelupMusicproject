/*
  # Revert public_catalog_products + producer_beats_ranked to SECURITY DEFINER

  ## Why
  Migrations 235 and 236 converted all 9 security_definer views to security_invoker.
  For two of them this broke the "Top beats" section on producer profile pages:

    public_catalog_products  → complex multi-table join, relies on columns added by
                               10+ migrations after the anon column-grant whitelist
                               (migration 086). Granting each new column individually
                               is fragile and error-prone as the schema evolves.

    producer_beats_ranked    → aggregates purchase counts across all products;
                               security_invoker would require anon SELECT on purchases
                               AND the correct column grants for each future column;
                               keeping security_definer is safer here.

  ## Trade-off accepted
  These two views will remain flagged by the Supabase Security Advisor.
  The other 7 views (producer_revenue_view, producer_stats, products_public,
  public_products, admin_revenue_breakdown, fallback_payout_alerts,
  admin_battle_campaigns_public) keep security_invoker = true from migration 235.

  ## Security posture unchanged
  - Both views only expose columns that are already public-facing:
    watermarked_path (preview audio), cover_image_url, price, title, slug, etc.
  - master_path / master_url have been absent from both views since migration 086.
  - RLS still guards all tables; the SECURITY DEFINER context is postgres/service_role
    which cannot be escalated by a client query.
  - The view GRANTs (anon, authenticated, service_role) are unchanged.
*/

BEGIN;

ALTER VIEW public.producer_beats_ranked     SET (security_invoker = false);
ALTER VIEW public.public_catalog_products   SET (security_invoker = false);

COMMIT;
