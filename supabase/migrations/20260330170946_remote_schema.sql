drop policy "Active producers can create products" on "public"."products";

drop policy "Anyone can view products" on "public"."products";

drop policy "Buyers can view purchased products" on "public"."products";

drop policy "Producer can view own products" on "public"."products";

drop policy "Producers can delete their products" on "public"."products";

drop policy "Producers can insert products" on "public"."products";

drop policy "Producers can update own unsold products" on "public"."products";

drop policy "Producers can update their products" on "public"."products";

drop policy "Public can view active products" on "public"."products";

drop policy "Service role can insert failed credit allocations" on "public"."failed_credit_allocations";

drop policy "Service role can select failed credit allocations" on "public"."failed_credit_allocations";

drop policy "Service role can update failed credit allocations" on "public"."failed_credit_allocations";

drop policy "Owner can update own profile" on "public"."user_profiles";

revoke delete on table "public"."v_days" from "anon";

revoke insert on table "public"."v_days" from "anon";

revoke references on table "public"."v_days" from "anon";

revoke select on table "public"."v_days" from "anon";

revoke trigger on table "public"."v_days" from "anon";

revoke truncate on table "public"."v_days" from "anon";

revoke update on table "public"."v_days" from "anon";

revoke delete on table "public"."v_days" from "authenticated";

revoke insert on table "public"."v_days" from "authenticated";

revoke references on table "public"."v_days" from "authenticated";

revoke select on table "public"."v_days" from "authenticated";

revoke trigger on table "public"."v_days" from "authenticated";

revoke truncate on table "public"."v_days" from "authenticated";

revoke update on table "public"."v_days" from "authenticated";

alter table "public"."products" drop constraint "products_master_path_invariant";

drop view if exists "public"."admin_battle_quality_latest";

drop view if exists "public"."admin_revenue_breakdown";

drop view if exists "public"."fallback_payout_monitoring";

drop view if exists "public"."my_user_profile";

drop view if exists "public"."producer_revenue_view";

drop view if exists "public"."producer_stats";

drop view if exists "public"."products_public";

drop view if exists "public"."public_catalog_products";

drop view if exists "public"."public_producer_profiles";

drop view if exists "public"."public_products";

drop view if exists "public"."weekly_leaderboard";

drop view if exists "public"."fallback_payout_alerts";

drop view if exists "public"."producer_beats_ranked";

drop index if exists "public"."idx_user_profiles_stripe_account_id";

alter table "public"."user_profiles" alter column "stripe_account_id" set data type text using "stripe_account_id"::text;

drop extension if exists "http";

CREATE UNIQUE INDEX one_row_settings ON public.settings USING btree ((true));

CREATE UNIQUE INDEX settings_expr_idx ON public.settings USING btree ((true));

alter table "public"."products" add constraint "products_master_path_invariant" CHECK (((master_path IS NULL) OR (public.normalize_master_storage_path(master_path) ~~ ((((producer_id)::text || '/'::text) || (id)::text) || '/%'::text)))) NOT VALID not valid;

alter table "public"."products" validate constraint "products_master_path_invariant";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

create or replace view "public"."admin_revenue_breakdown" as  SELECT p.id,
    p.created_at,
    round(((COALESCE(p.amount, 0))::numeric / 100.0), 2) AS gross_eur,
    round(((COALESCE(p.producer_share_cents_snapshot, 0))::numeric / 100.0), 2) AS producer_share_eur,
    round(((COALESCE(p.platform_share_cents_snapshot, 0))::numeric / 100.0), 2) AS platform_share_eur,
    p.purchase_source,
    pr.title,
    buyer.email AS buyer_email,
    producer.email AS producer_email
   FROM (((public.purchases p
     JOIN public.products pr ON ((pr.id = p.product_id)))
     JOIN public.user_profiles buyer ON ((buyer.id = p.user_id)))
     JOIN public.user_profiles producer ON ((producer.id = pr.producer_id)))
  WHERE ((public.is_admin(auth.uid()) OR (COALESCE((auth.jwt() ->> 'role'::text), current_setting('request.jwt.claim.role'::text, true), ''::text) = 'service_role'::text)) AND (p.status = 'completed'::public.purchase_status));


create or replace view "public"."fallback_payout_alerts" as  SELECT p.id AS purchase_id,
    p.producer_id,
    COALESCE(NULLIF(up.username, ''::text), split_part(up.email, '@'::text, 1), (p.producer_id)::text) AS username,
    up.email,
    round((COALESCE(
        CASE
            WHEN (COALESCE((p.metadata ->> 'payout_amount'::text), ''::text) ~ '^-?[0-9]+$'::text) THEN ((p.metadata ->> 'payout_amount'::text))::numeric
            ELSE NULL::numeric
        END, (p.producer_share_cents_snapshot)::numeric, (0)::numeric) / 100.0), 2) AS payout_amount_eur,
    (GREATEST((0)::numeric, floor((EXTRACT(epoch FROM (now() - COALESCE(p.completed_at, p.created_at))) / (86400)::numeric))))::integer AS days_pending,
        CASE
            WHEN (COALESCE(p.completed_at, p.created_at) <= (now() - '14 days'::interval)) THEN 'CRITIQUE > 14 jours'::text
            WHEN (COALESCE(p.completed_at, p.created_at) <= (now() - '7 days'::interval)) THEN 'WARNING > 7 jours'::text
            ELSE 'OK < 7 jours'::text
        END AS urgency_level
   FROM (public.purchases p
     JOIN public.user_profiles up ON ((up.id = p.producer_id)))
  WHERE ((public.is_admin(auth.uid()) OR (COALESCE((auth.jwt() ->> 'role'::text), current_setting('request.jwt.claim.role'::text, true), ''::text) = 'service_role'::text)) AND (p.status = 'completed'::public.purchase_status) AND (COALESCE((p.metadata ->> 'payout_mode'::text), ''::text) = 'platform_fallback'::text) AND (lower(COALESCE((p.metadata ->> 'requires_manual_payout'::text), 'false'::text)) = ANY (ARRAY['true'::text, 't'::text, '1'::text])) AND (COALESCE((p.metadata ->> 'payout_status'::text), 'pending'::text) = 'pending'::text) AND (COALESCE((p.metadata ->> 'payout_processed_at'::text), ''::text) = ''::text) AND (COALESCE(
        CASE
            WHEN (COALESCE((p.metadata ->> 'payout_amount'::text), ''::text) ~ '^-?[0-9]+$'::text) THEN ((p.metadata ->> 'payout_amount'::text))::integer
            ELSE NULL::integer
        END, p.producer_share_cents_snapshot, 0) > 0));


create or replace view "public"."fallback_payout_monitoring" as  SELECT purchase_id,
    producer_id,
    username,
    email,
    payout_amount_eur AS amount_owed_eur,
    days_pending,
        CASE
            WHEN (urgency_level ~~ 'CRITIQUE%'::text) THEN 'CRITICAL'::text
            WHEN (urgency_level ~~ 'WARNING%'::text) THEN 'WARNING'::text
            ELSE 'OK'::text
        END AS urgency
   FROM public.fallback_payout_alerts fpa;


create or replace view "public"."my_user_profile" as  SELECT id,
    id AS user_id,
    username,
    full_name,
    avatar_url,
    role,
    producer_tier,
    is_producer_active,
    total_purchases,
    confirmed_at,
    producer_verified_at,
    battle_refusal_count,
    battles_participated,
    battles_completed,
    engagement_score,
    language,
    bio,
    website_url,
    social_links,
    created_at,
    updated_at,
    is_deleted,
    deleted_at,
    delete_reason,
    deleted_label
   FROM public.user_profiles up
  WHERE (id = auth.uid());


create or replace view "public"."producer_beats_ranked" as  WITH published_beats AS (
         SELECT p.id,
            p.producer_id,
            p.title,
            p.slug,
            p.cover_image_url,
            p.price,
            p.play_count,
            p.created_at,
            p.updated_at,
            COALESCE(p.status, 'active'::text) AS status,
            COALESCE(p.is_published, false) AS is_published
           FROM public.products p
          WHERE ((p.product_type = 'beat'::public.product_type) AND (p.deleted_at IS NULL) AND (COALESCE(p.is_published, false) = true) AND (COALESCE(p.status, 'active'::text) = 'active'::text))
        ), sales_by_product AS (
         SELECT pu.product_id,
            (count(*))::integer AS sales_count
           FROM public.purchases pu
          WHERE (pu.status = 'completed'::public.purchase_status)
          GROUP BY pu.product_id
        ), battle_wins_by_product AS (
         SELECT ranked_battles.winner_product_id AS product_id,
            (count(*))::integer AS battle_wins
           FROM ( SELECT
                        CASE
                            WHEN (b.winner_id = b.producer1_id) THEN b.product1_id
                            WHEN (b.winner_id = b.producer2_id) THEN b.product2_id
                            ELSE NULL::uuid
                        END AS winner_product_id
                   FROM public.battles b
                  WHERE ((b.status = 'completed'::public.battle_status) AND (b.winner_id IS NOT NULL))) ranked_battles
          WHERE (ranked_battles.winner_product_id IS NOT NULL)
          GROUP BY ranked_battles.winner_product_id
        ), scored AS (
         SELECT pb.id,
            pb.producer_id,
            pb.title,
            pb.slug,
            pb.cover_image_url,
            pb.price,
            pb.play_count,
            COALESCE(s_1.sales_count, 0) AS sales_count,
            public.compute_sales_tier(COALESCE(s_1.sales_count, 0)) AS sales_tier,
            COALESCE(w.battle_wins, 0) AS battle_wins,
            GREATEST(0, (30 - (floor((EXTRACT(epoch FROM (now() - pb.created_at)) / 86400.0)))::integer)) AS recency_bonus,
            (((LEAST(COALESCE(pb.play_count, 0), 1000) + (COALESCE(s_1.sales_count, 0) * 25)) + (COALESCE(w.battle_wins, 0) * 15)) + GREATEST(0, (30 - (floor((EXTRACT(epoch FROM (now() - pb.created_at)) / 86400.0)))::integer))) AS performance_score,
            ((COALESCE(pb.play_count, 0) + COALESCE(s_1.sales_count, 0)) + COALESCE(w.battle_wins, 0)) AS engagement_count,
            pb.created_at,
            pb.updated_at
           FROM ((published_beats pb
             LEFT JOIN sales_by_product s_1 ON ((s_1.product_id = pb.id)))
             LEFT JOIN battle_wins_by_product w ON ((w.product_id = pb.id)))
        )
 SELECT id,
    producer_id,
    title,
    slug,
    cover_image_url,
    price,
    play_count,
    sales_count,
    sales_tier,
    battle_wins,
    recency_bonus,
    performance_score,
    engagement_count,
    (row_number() OVER (PARTITION BY producer_id ORDER BY performance_score DESC, sales_count DESC, battle_wins DESC, play_count DESC, created_at DESC, id))::integer AS producer_rank,
    ((engagement_count > 0) AND (row_number() OVER (PARTITION BY producer_id ORDER BY performance_score DESC, sales_count DESC, battle_wins DESC, play_count DESC, created_at DESC, id) <= 10)) AS top_10_flag,
    created_at,
    updated_at
   FROM scored s;


create or replace view "public"."producer_revenue_view" as  SELECT p.id,
    p.created_at,
    p.product_id,
    pr.title AS product_title,
    p.purchase_source,
    round(((COALESCE(p.producer_share_cents_snapshot, 0))::numeric / 100.0), 2) AS amount_earned_eur,
    COALESCE((p.metadata ->> 'payout_status'::text), 'pending'::text) AS payout_status,
    COALESCE((p.metadata ->> 'payout_mode'::text), 'stripe_connect'::text) AS payout_mode,
        CASE
            WHEN ((p.metadata ->> 'payout_processed_at'::text) IS NOT NULL) THEN ((p.metadata ->> 'payout_processed_at'::text))::timestamp with time zone
            ELSE NULL::timestamp with time zone
        END AS payout_processed_at
   FROM (public.purchases p
     JOIN public.products pr ON ((pr.id = p.product_id)))
  WHERE ((pr.producer_id = auth.uid()) AND (p.status = 'completed'::public.purchase_status))
  ORDER BY p.created_at DESC;


create or replace view "public"."producer_stats" as  SELECT p.producer_id,
    count(DISTINCT p.id) AS total_products,
    count(DISTINCT p.id) FILTER (WHERE (p.is_published = true)) AS published_products,
    count(DISTINCT pur.id) AS total_sales,
    COALESCE(sum(pur.amount) FILTER (WHERE (pur.status = 'completed'::public.purchase_status)), (0)::bigint) AS total_revenue,
    COALESCE(sum(p.play_count), (0)::bigint) AS total_plays
   FROM (public.products p
     LEFT JOIN public.purchases pur ON ((pur.product_id = p.id)))
  GROUP BY p.producer_id;


create or replace view "public"."products_public" as  SELECT id,
    title,
    price,
    status
   FROM public.products;


create or replace view "public"."public_producer_profiles" as  SELECT up.id AS user_id,
    public.get_public_profile_label(up.*) AS username,
        CASE
            WHEN ((COALESCE(up.is_deleted, false) = true) OR (up.deleted_at IS NOT NULL)) THEN NULL::text
            ELSE up.avatar_url
        END AS avatar_url,
    up.producer_tier,
        CASE
            WHEN ((COALESCE(up.is_deleted, false) = true) OR (up.deleted_at IS NOT NULL)) THEN NULL::text
            ELSE up.bio
        END AS bio,
        CASE
            WHEN ((COALESCE(up.is_deleted, false) = true) OR (up.deleted_at IS NOT NULL)) THEN '{}'::jsonb
            ELSE COALESCE(up.social_links, '{}'::jsonb)
        END AS social_links,
    COALESCE(ur.xp, (0)::bigint) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze'::text) AS rank_tier,
    COALESCE(ur.reputation_score, (0)::numeric) AS reputation_score,
    up.created_at,
    up.updated_at,
    up.username AS raw_username,
    ((COALESCE(up.is_deleted, false) = true) OR (up.deleted_at IS NOT NULL)) AS is_deleted,
    COALESCE(up.is_producer_active, false) AS is_producer_active
   FROM (public.user_profiles up
     LEFT JOIN public.user_reputation ur ON ((ur.user_id = up.id)))
  WHERE (NULLIF(btrim(COALESCE(up.username, ''::text)), ''::text) IS NOT NULL);


create or replace view "public"."public_products" as  SELECT id,
    producer_id,
    title,
    slug,
    description,
    product_type,
    genre_id,
    mood_id,
    bpm,
    key_signature,
    price,
    watermarked_path,
    preview_url,
    exclusive_preview_url,
    cover_image_url,
    is_exclusive,
    is_sold,
    sold_at,
    sold_to_user_id,
    is_published,
    play_count,
    tags,
    duration_seconds,
    file_format,
    license_terms,
    watermark_profile_id,
    created_at,
    updated_at,
    deleted_at
   FROM public.products;


create or replace view "public"."weekly_leaderboard" as  WITH recent_battles AS (
         SELECT b.id,
            b.producer1_id,
            b.producer2_id,
            b.winner_id
           FROM public.battles b
          WHERE ((b.status = 'completed'::public.battle_status) AND (b.updated_at >= (now() - '7 days'::interval)))
        ), participants AS (
         SELECT rb.producer1_id AS user_id,
                CASE
                    WHEN (rb.winner_id = rb.producer1_id) THEN 1
                    ELSE 0
                END AS win,
                CASE
                    WHEN ((rb.winner_id IS NOT NULL) AND (rb.winner_id <> rb.producer1_id)) THEN 1
                    ELSE 0
                END AS loss
           FROM recent_battles rb
          WHERE (rb.producer1_id IS NOT NULL)
        UNION ALL
         SELECT rb.producer2_id AS user_id,
                CASE
                    WHEN (rb.winner_id = rb.producer2_id) THEN 1
                    ELSE 0
                END AS win,
                CASE
                    WHEN ((rb.winner_id IS NOT NULL) AND (rb.winner_id <> rb.producer2_id)) THEN 1
                    ELSE 0
                END AS loss
           FROM recent_battles rb
          WHERE (rb.producer2_id IS NOT NULL)
        ), agg AS (
         SELECT p.user_id,
            (sum(p.win))::integer AS weekly_wins,
            (sum(p.loss))::integer AS weekly_losses
           FROM participants p
          GROUP BY p.user_id
        )
 SELECT up.id AS user_id,
    up.username,
    a.weekly_wins,
    a.weekly_losses,
        CASE
            WHEN ((a.weekly_wins + a.weekly_losses) = 0) THEN (0)::numeric
            ELSE round((((a.weekly_wins)::numeric / ((a.weekly_wins + a.weekly_losses))::numeric) * (100)::numeric), 2)
        END AS weekly_winrate,
    row_number() OVER (ORDER BY a.weekly_wins DESC, a.weekly_losses, up.username, up.id) AS rank_position
   FROM (agg a
     JOIN public.user_profiles up ON ((up.id = a.user_id)))
  WHERE ((up.is_producer_active = true) AND (up.role = ANY (ARRAY['producer'::public.user_role, 'admin'::public.user_role])))
  ORDER BY (row_number() OVER (ORDER BY a.weekly_wins DESC, a.weekly_losses, up.username, up.id));


create or replace view "public"."admin_battle_quality_latest" as  SELECT bqs.battle_id,
    b.slug AS battle_slug,
    b.title AS battle_title,
    b.status AS battle_status,
    bqs.product_id,
    p.title AS product_title,
    p.producer_id,
    ppp.username AS producer_username,
    bqs.votes_total,
    bqs.votes_for_product,
    bqs.win_rate,
    bqs.preference_score,
    bqs.artistic_score,
    bqs.coherence_score,
    bqs.credibility_score,
    bqs.quality_index,
    bqs.meta,
    bqs.computed_at,
    bqs.updated_at
   FROM (((public.battle_quality_snapshots bqs
     JOIN public.battles b ON ((b.id = bqs.battle_id)))
     JOIN public.products p ON ((p.id = bqs.product_id)))
     LEFT JOIN public.public_producer_profiles ppp ON ((ppp.user_id = p.producer_id)));


create or replace view "public"."public_catalog_products" as  SELECT p.id,
    p.producer_id,
    p.title,
    p.slug,
    p.description,
    p.product_type,
    p.genre_id,
    g.name AS genre_name,
    g.name_en AS genre_name_en,
    g.name_de AS genre_name_de,
    g.slug AS genre_slug,
    p.mood_id,
    m.name AS mood_name,
    m.name_en AS mood_name_en,
    m.name_de AS mood_name_de,
    m.slug AS mood_slug,
    p.bpm,
    p.key_signature,
    p.price,
    p.watermarked_path,
    p.watermarked_bucket,
    p.preview_url,
    p.exclusive_preview_url,
    p.cover_image_url,
    p.is_exclusive,
    p.is_sold,
    p.sold_at,
        CASE
            WHEN (auth.role() = 'service_role'::text) THEN p.sold_to_user_id
            ELSE NULL::uuid
        END AS sold_to_user_id,
    p.is_published,
    p.status,
    p.version,
    p.original_beat_id,
    p.version_number,
    p.parent_product_id,
    p.archived_at,
    p.play_count,
    p.tags,
    p.duration_seconds,
    p.file_format,
    p.license_terms,
    p.watermark_profile_id,
    p.created_at,
    p.updated_at,
    p.deleted_at,
    pp.username AS producer_username,
    pp.raw_username AS producer_raw_username,
    pp.avatar_url AS producer_avatar_url,
    COALESCE(pp.is_producer_active, false) AS producer_is_active,
    COALESCE(pbr.sales_count, 0) AS sales_count,
    COALESCE(pbr.battle_wins, 0) AS battle_wins,
    COALESCE(pbr.recency_bonus, 0) AS recency_bonus,
    COALESCE(pbr.performance_score, 0) AS performance_score,
    pbr.producer_rank,
    COALESCE(pbr.top_10_flag, false) AS top_10_flag,
    p.early_access_until
   FROM ((((public.products p
     LEFT JOIN public.public_producer_profiles pp ON ((pp.user_id = p.producer_id)))
     LEFT JOIN public.genres g ON ((g.id = p.genre_id)))
     LEFT JOIN public.moods m ON ((m.id = p.mood_id)))
     LEFT JOIN public.producer_beats_ranked pbr ON ((pbr.id = p.id)))
  WHERE ((p.deleted_at IS NULL) AND (COALESCE(p.is_published, false) = true) AND ((p.product_type <> 'beat'::public.product_type) OR (p.early_access_until IS NULL) OR (p.early_access_until <= now()) OR public.user_has_active_buyer_subscription(auth.uid())));


grant select on table "public"."products" to "anon";

grant select on table "public"."products" to "authenticated";


  create policy "Users can delete their own cart items"
  on "public"."cart_items"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "Users can insert their own cart items"
  on "public"."cart_items"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "Users can view their own cart items"
  on "public"."cart_items"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "Authenticated users can view all products"
  on "public"."products"
  as permissive
  for select
  to authenticated
using (true);



  create policy "Producers can delete their own products"
  on "public"."products"
  as permissive
  for delete
  to authenticated
using ((producer_id = auth.uid()));



  create policy "Producers can insert their own products"
  on "public"."products"
  as permissive
  for insert
  to authenticated
with check ((producer_id = auth.uid()));



  create policy "Producers can update their own products"
  on "public"."products"
  as permissive
  for update
  to authenticated
using ((producer_id = auth.uid()))
with check ((producer_id = auth.uid()));



  create policy "Producers can view their own products"
  on "public"."products"
  as permissive
  for select
  to authenticated
using ((producer_id = auth.uid()));



  create policy "Public can view published products"
  on "public"."products"
  as permissive
  for select
  to public
using ((is_published = true));



  create policy "Public read products simple"
  on "public"."products"
  as permissive
  for select
  to anon
using (true);



  create policy "Allow insert via service role only"
  on "public"."waitlist"
  as permissive
  for insert
  to service_role
with check (true);



  create policy "Service role can insert failed credit allocations"
  on "public"."failed_credit_allocations"
  as permissive
  for insert
  to public
with check ((auth.role() = 'service_role'::text));



  create policy "Service role can select failed credit allocations"
  on "public"."failed_credit_allocations"
  as permissive
  for select
  to public
using ((auth.role() = 'service_role'::text));



  create policy "Service role can update failed credit allocations"
  on "public"."failed_credit_allocations"
  as permissive
  for update
  to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));



  create policy "Owner can update own profile"
  on "public"."user_profiles"
  as permissive
  for update
  to authenticated
using (((id = auth.uid()) AND (COALESCE(is_deleted, false) = false) AND (deleted_at IS NULL)))
with check (((id = auth.uid()) AND (COALESCE(is_deleted, false) = false) AND (deleted_at IS NULL) AND (NOT (role IS DISTINCT FROM ( SELECT user_profiles_1.role
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (producer_tier IS DISTINCT FROM ( SELECT user_profiles_1.producer_tier
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (is_confirmed IS DISTINCT FROM ( SELECT user_profiles_1.is_confirmed
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (is_producer_active IS DISTINCT FROM ( SELECT user_profiles_1.is_producer_active
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (stripe_customer_id IS DISTINCT FROM ( SELECT user_profiles_1.stripe_customer_id
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (stripe_subscription_id IS DISTINCT FROM ( SELECT user_profiles_1.stripe_subscription_id
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (subscription_status IS DISTINCT FROM ( SELECT user_profiles_1.subscription_status
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (total_purchases IS DISTINCT FROM ( SELECT user_profiles_1.total_purchases
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (confirmed_at IS DISTINCT FROM ( SELECT user_profiles_1.confirmed_at
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (producer_verified_at IS DISTINCT FROM ( SELECT user_profiles_1.producer_verified_at
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (battle_refusal_count IS DISTINCT FROM ( SELECT user_profiles_1.battle_refusal_count
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (battles_participated IS DISTINCT FROM ( SELECT user_profiles_1.battles_participated
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (battles_completed IS DISTINCT FROM ( SELECT user_profiles_1.battles_completed
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (engagement_score IS DISTINCT FROM ( SELECT user_profiles_1.engagement_score
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (elo_rating IS DISTINCT FROM ( SELECT user_profiles_1.elo_rating
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (battle_wins IS DISTINCT FROM ( SELECT user_profiles_1.battle_wins
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (battle_losses IS DISTINCT FROM ( SELECT user_profiles_1.battle_losses
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (battle_draws IS DISTINCT FROM ( SELECT user_profiles_1.battle_draws
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (is_deleted IS DISTINCT FROM ( SELECT user_profiles_1.is_deleted
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (deleted_at IS DISTINCT FROM ( SELECT user_profiles_1.deleted_at
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (delete_reason IS DISTINCT FROM ( SELECT user_profiles_1.delete_reason
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid())))) AND (NOT (deleted_label IS DISTINCT FROM ( SELECT user_profiles_1.deleted_label
   FROM public.user_profiles user_profiles_1
  WHERE (user_profiles_1.id = auth.uid()))))));


CREATE TRIGGER trg_failed_credit_allocations_updated_at BEFORE UPDATE ON public.failed_credit_allocations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

