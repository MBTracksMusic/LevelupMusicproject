create extension if not exists "wrappers" with schema "extensions";

drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";

alter table "public"."producer_plans" drop constraint "producer_plans_price_valid_format";

drop view if exists "public"."admin_battle_quality_latest";

drop view if exists "public"."producer_stats";

drop view if exists "public"."public_catalog_products";

drop view if exists "public"."public_products";

drop view if exists "public"."producer_beats_ranked";

drop index if exists "public"."idx_battles_status_awaiting_admin";

drop index if exists "public"."idx_battles_status_response_deadline";


  create table "public"."v_days" (
    "coalesce" integer
      );


alter table "public"."v_days" enable row level security;


  create table "public"."watermark_profiles" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "enabled" boolean not null default true,
    "overlay_audio_path" text,
    "beep_frequency_hz" integer,
    "beep_duration_ms" integer,
    "repeat_every_ms" integer,
    "gain_db" numeric(5,2),
    "voice_tag_text" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."watermark_profiles" enable row level security;

alter table "public"."products" add column "master_path" text;

alter table "public"."products" add column "watermark_profile_id" uuid;

alter table "public"."products" add column "watermarked_path" text;

alter table "public"."waitlist" alter column "id" set default gen_random_uuid();

CREATE INDEX idx_products_master_path ON public.products USING btree (master_path) WHERE (master_path IS NOT NULL);

CREATE INDEX idx_products_watermarked_path ON public.products USING btree (watermarked_path) WHERE (watermarked_path IS NOT NULL);

CREATE INDEX stripe_events_processing_idx ON public.stripe_events USING btree (processed, processing_started_at);

CREATE UNIQUE INDEX watermark_profiles_name_key ON public.watermark_profiles USING btree (name);

CREATE UNIQUE INDEX watermark_profiles_pkey ON public.watermark_profiles USING btree (id);

CREATE INDEX idx_battles_status_awaiting_admin ON public.battles USING btree (status, created_at DESC) WHERE (status = 'awaiting_admin'::public.battle_status);

CREATE INDEX idx_battles_status_response_deadline ON public.battles USING btree (status, response_deadline) WHERE (status = 'pending_acceptance'::public.battle_status);

alter table "public"."watermark_profiles" add constraint "watermark_profiles_pkey" PRIMARY KEY using index "watermark_profiles_pkey";

update "public"."producer_plans"
set "stripe_price_id" = ('price_shadow_' || regexp_replace("tier"::text, '[^A-Za-z0-9]', '', 'g'))
where "tier" <> 'user'::public.producer_tier_type
  and "stripe_price_id" is null;

alter table "public"."producer_plans" add constraint "producer_plans_price_not_null" CHECK (((tier = 'user'::public.producer_tier_type) OR (stripe_price_id IS NOT NULL))) not valid;

alter table "public"."producer_plans" validate constraint "producer_plans_price_not_null";

alter table "public"."products" add constraint "products_master_path_invariant" CHECK (((master_path IS NULL) OR (public.normalize_master_storage_path(master_path) ~~ ((((producer_id)::text || '/'::text) || (id)::text) || '/%'::text)))) NOT VALID not valid;

alter table "public"."products" validate constraint "products_master_path_invariant";

alter table "public"."products" add constraint "products_price_positive" CHECK ((price > 0)) not valid;

alter table "public"."products" validate constraint "products_price_positive";

alter table "public"."products" add constraint "products_watermark_profile_id_fkey" FOREIGN KEY (watermark_profile_id) REFERENCES public.watermark_profiles(id) ON DELETE SET NULL not valid;

alter table "public"."products" validate constraint "products_watermark_profile_id_fkey";

alter table "public"."watermark_profiles" add constraint "watermark_profiles_name_key" UNIQUE using index "watermark_profiles_name_key";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.force_battle_insert_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.lock_battle_created_at_on_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$function$
;

create or replace view "public"."products_public" as  SELECT id,
    title,
    price,
    status
   FROM public.products;


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


create or replace view "public"."producer_stats" as  SELECT p.producer_id,
    count(DISTINCT p.id) AS total_products,
    count(DISTINCT p.id) FILTER (WHERE (p.is_published = true)) AS published_products,
    count(DISTINCT pur.id) AS total_sales,
    COALESCE(sum(pur.amount) FILTER (WHERE (pur.status = 'completed'::public.purchase_status)), (0)::bigint) AS total_revenue,
    COALESCE(sum(p.play_count), (0)::bigint) AS total_plays
   FROM (public.products p
     LEFT JOIN public.purchases pur ON ((pur.product_id = p.id)))
  GROUP BY p.producer_id;


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
    pbr.sales_tier,
    COALESCE(pbr.battle_wins, 0) AS battle_wins,
    COALESCE(pbr.recency_bonus, 0) AS recency_bonus,
    COALESCE(pbr.performance_score, 0) AS performance_score,
    pbr.producer_rank,
    COALESCE(pbr.top_10_flag, false) AS top_10_flag
   FROM ((((public.products p
     LEFT JOIN public.public_producer_profiles pp ON ((pp.user_id = p.producer_id)))
     LEFT JOIN public.genres g ON ((g.id = p.genre_id)))
     LEFT JOIN public.moods m ON ((m.id = p.mood_id)))
     LEFT JOIN public.producer_beats_ranked pbr ON ((pbr.id = p.id)))
  WHERE ((p.deleted_at IS NULL) AND ((p.product_type <> 'beat'::public.product_type) OR (p.early_access_until IS NULL) OR (p.early_access_until <= now()) OR public.user_has_active_buyer_subscription(auth.uid())));


grant delete on table "public"."v_days" to "service_role";

grant insert on table "public"."v_days" to "service_role";

grant references on table "public"."v_days" to "service_role";

grant select on table "public"."v_days" to "service_role";

grant trigger on table "public"."v_days" to "service_role";

grant truncate on table "public"."v_days" to "service_role";

grant update on table "public"."v_days" to "service_role";

grant delete on table "public"."watermark_profiles" to "anon";

grant insert on table "public"."watermark_profiles" to "anon";

grant references on table "public"."watermark_profiles" to "anon";

grant select on table "public"."watermark_profiles" to "anon";

grant trigger on table "public"."watermark_profiles" to "anon";

grant truncate on table "public"."watermark_profiles" to "anon";

grant update on table "public"."watermark_profiles" to "anon";

grant delete on table "public"."watermark_profiles" to "authenticated";

grant insert on table "public"."watermark_profiles" to "authenticated";

grant references on table "public"."watermark_profiles" to "authenticated";

grant select on table "public"."watermark_profiles" to "authenticated";

grant trigger on table "public"."watermark_profiles" to "authenticated";

grant truncate on table "public"."watermark_profiles" to "authenticated";

grant update on table "public"."watermark_profiles" to "authenticated";

grant delete on table "public"."watermark_profiles" to "service_role";

grant insert on table "public"."watermark_profiles" to "service_role";

grant references on table "public"."watermark_profiles" to "service_role";

grant select on table "public"."watermark_profiles" to "service_role";

grant trigger on table "public"."watermark_profiles" to "service_role";

grant truncate on table "public"."watermark_profiles" to "service_role";

grant update on table "public"."watermark_profiles" to "service_role";


  create policy "Anyone can view products"
  on "public"."products"
  as permissive
  for select
  to public
using (true);



  create policy "Producers can delete their products"
  on "public"."products"
  as permissive
  for delete
  to authenticated
using ((auth.uid() = producer_id));



  create policy "Producers can insert products"
  on "public"."products"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = producer_id));



  create policy "Producers can update their products"
  on "public"."products"
  as permissive
  for update
  to authenticated
using ((auth.uid() = producer_id));



  create policy "v_days_no_client_access"
  on "public"."v_days"
  as permissive
  for all
  to anon, authenticated
using (false)
with check (false);



  create policy "Admins can manage watermark profiles"
  on "public"."watermark_profiles"
  as permissive
  for all
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::public.user_role)))))
with check ((EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::public.user_role)))));


CREATE TRIGGER trg_force_battle_insert_timestamps BEFORE INSERT ON public.battles FOR EACH ROW EXECUTE FUNCTION public.force_battle_insert_timestamps();

CREATE TRIGGER trg_lock_battle_created_at_on_update BEFORE UPDATE ON public.battles FOR EACH ROW EXECUTE FUNCTION public.lock_battle_created_at_on_update();


  create policy "Buyers can read own contracts 10hxipc_0"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'purchase_contracts'::text) AND (EXISTS ( SELECT 1
   FROM public.purchases p
  WHERE ((p.user_id = auth.uid()) AND (p.contract_pdf_path = objects.name))))));


