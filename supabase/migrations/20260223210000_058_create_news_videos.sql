/*
  # Create news_videos table for homepage announcements

  Additive migration:
  - Adds admin-managed news video records
  - Public can only read published rows
  - Admin can read/write all rows via public.is_admin(auth.uid())
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.news_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  video_url text NOT NULL,
  thumbnail_url text,
  is_published boolean NOT NULL DEFAULT false,
  broadcast_email boolean NOT NULL DEFAULT false,
  broadcast_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_videos_published_created_at_desc
  ON public.news_videos (created_at DESC)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_news_videos_is_published_created_at_desc
  ON public.news_videos (is_published, created_at DESC);

DROP TRIGGER IF EXISTS update_news_videos_updated_at ON public.news_videos;
CREATE TRIGGER update_news_videos_updated_at
  BEFORE UPDATE ON public.news_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.news_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published news videos" ON public.news_videos;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'news_videos'
    AND policyname = 'Public can read published news videos'
  ) THEN
    CREATE POLICY "Public can read published news videos"
  ON public.news_videos
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true);
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can read all news videos" ON public.news_videos;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'news_videos'
    AND policyname = 'Admins can read all news videos'
  ) THEN
    CREATE POLICY "Admins can read all news videos"
  ON public.news_videos
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can insert news videos" ON public.news_videos;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'news_videos'
    AND policyname = 'Admins can insert news videos'
  ) THEN
    CREATE POLICY "Admins can insert news videos"
  ON public.news_videos
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can update news videos" ON public.news_videos;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'news_videos'
    AND policyname = 'Admins can update news videos'
  ) THEN
    CREATE POLICY "Admins can update news videos"
  ON public.news_videos
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can delete news videos" ON public.news_videos;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'news_videos'
    AND policyname = 'Admins can delete news videos'
  ) THEN
    CREATE POLICY "Admins can delete news videos"
  ON public.news_videos
  FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));
  END IF;
END $$;

COMMIT;
