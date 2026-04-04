alter table "public"."producer_plans" drop constraint "producer_plans_price_not_null";

alter table "public"."products" drop constraint "products_master_path_invariant";

drop view if exists "public"."admin_battle_quality_latest";

drop view if exists "public"."admin_revenue_breakdown";

drop view if exists "public"."producer_revenue_view";

drop view if exists "public"."producer_stats";

drop view if exists "public"."products_public";

drop view if exists "public"."public_catalog_products";

drop view if exists "public"."public_products";

drop view if exists "public"."producer_beats_ranked";

alter table "public"."settings" add column "show_pricing_plans" boolean not null default true;

alter table "public"."products" add constraint "products_master_path_invariant" CHECK (((master_path IS NULL) OR (public.normalize_master_storage_path(master_path) ~~ ((((producer_id)::text || '/'::text) || (id)::text) || '/%'::text)))) NOT VALID not valid;

alter table "public"."products" validate constraint "products_master_path_invariant";

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



