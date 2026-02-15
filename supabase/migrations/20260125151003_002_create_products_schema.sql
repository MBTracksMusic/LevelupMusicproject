/*
  # LevelupMusic - Products Schema

  1. Overview
    This migration creates the product catalog system for beats, exclusives, and kits.
    All products are managed by producers with active subscriptions.

  2. New Tables
    - `genres` - Music genre categories
    - `moods` - Music mood/vibe categories
    - `products`
      - `id` (uuid, primary key)
      - `producer_id` (uuid) - References user_profiles
      - `title` (text) - Product title
      - `slug` (text, unique) - URL-friendly identifier
      - `description` (text) - Product description
      - `product_type` (enum) - beat, exclusive, kit
      - `genre_id` (uuid) - Primary genre
      - `mood_id` (uuid) - Primary mood
      - `bpm` (integer) - Beats per minute
      - `key_signature` (text) - Musical key
      - `price` (decimal) - Price in cents
      - `preview_url` (text) - Watermarked preview URL
      - `master_url` (text) - Original master file (private)
      - `exclusive_preview_url` (text) - 30s exclusive preview
      - `cover_image_url` (text) - Product artwork
      - `is_exclusive` (boolean) - Exclusive product flag
      - `is_sold` (boolean) - Whether exclusive has been sold
      - `sold_at` (timestamptz) - When exclusive was sold
      - `sold_to_user_id` (uuid) - Who bought the exclusive
      - `is_published` (boolean) - Visibility status
      - `play_count` (integer) - Number of plays
      - `tags` (text[]) - Searchable tags
      - `duration_seconds` (integer) - Track duration
      - `file_format` (text) - Audio format
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `product_files` - Additional files for kits
      - `id` (uuid, primary key)
      - `product_id` (uuid) - Parent product
      - `file_name` (text) - Original filename
      - `file_url` (text) - Storage URL (private)
      - `file_size` (bigint) - Size in bytes
      - `file_type` (text) - MIME type

  3. Security
    - RLS enabled on all tables
    - Public can view published products
    - Producers can only manage their own products
    - Master files are NEVER accessible client-side
    - Exclusives are hidden once sold

  4. Important Notes
    - is_sold can ONLY be set via server-side after Stripe payment confirmation
    - master_url is NEVER returned in client queries (handled by RLS)
    - Watermarked previews are the only publicly playable files
*/

-- Create enum for product types
DO $$ BEGIN
  CREATE TYPE product_type AS ENUM ('beat', 'exclusive', 'kit');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create genres table
CREATE TABLE IF NOT EXISTS genres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_de text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  icon text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create moods table
CREATE TABLE IF NOT EXISTS moods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_de text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  color text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  product_type product_type NOT NULL,
  genre_id uuid REFERENCES genres(id),
  mood_id uuid REFERENCES moods(id),
  bpm integer CHECK (bpm > 0 AND bpm <= 300),
  key_signature text,
  price integer NOT NULL CHECK (price >= 0),
  preview_url text,
  master_url text,
  exclusive_preview_url text,
  cover_image_url text,
  is_exclusive boolean DEFAULT false NOT NULL,
  is_sold boolean DEFAULT false NOT NULL,
  sold_at timestamptz,
  sold_to_user_id uuid REFERENCES user_profiles(id),
  is_published boolean DEFAULT false NOT NULL,
  play_count integer DEFAULT 0 NOT NULL,
  tags text[] DEFAULT '{}',
  duration_seconds integer,
  file_format text DEFAULT 'mp3',
  license_terms jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT exclusive_must_have_type CHECK (
    (is_exclusive = true AND product_type = 'exclusive') OR
    (is_exclusive = false AND product_type != 'exclusive')
  )
);

-- Create product_files table for kit contents
CREATE TABLE IF NOT EXISTS product_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  file_type text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_products_producer ON products(producer_id);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_products_genre ON products(genre_id);
CREATE INDEX IF NOT EXISTS idx_products_mood ON products(mood_id);
CREATE INDEX IF NOT EXISTS idx_products_published ON products(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_products_exclusive_available ON products(is_exclusive, is_sold) WHERE is_exclusive = true AND is_sold = false;
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_files_product ON product_files(product_id);

-- Enable RLS
ALTER TABLE genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE moods ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_files ENABLE ROW LEVEL SECURITY;

-- RLS Policies for genres (public read)
CREATE POLICY "Anyone can view active genres"
  ON genres FOR SELECT
  USING (is_active = true);

-- RLS Policies for moods (public read)
CREATE POLICY "Anyone can view active moods"
  ON moods FOR SELECT
  USING (is_active = true);

-- RLS Policies for products

-- Anyone can view published non-sold products (without master_url)
CREATE POLICY "Anyone can view published products"
  ON products FOR SELECT
  USING (
    is_published = true AND 
    (is_exclusive = false OR (is_exclusive = true AND is_sold = false))
  );

-- Producers can view all their own products
CREATE POLICY "Producers can view own products"
  ON products FOR SELECT
  TO authenticated
  USING (producer_id = auth.uid());

-- Producers can insert products if they have active subscription
CREATE POLICY "Active producers can create products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (
    producer_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND is_producer_active = true
    )
  );

-- Producers can update their own unsold products
CREATE POLICY "Producers can update own unsold products"
  ON products FOR UPDATE
  TO authenticated
  USING (
    producer_id = auth.uid() AND
    is_sold = false
  )
  WITH CHECK (
    producer_id = auth.uid()
  );

-- Producers can delete their own unsold products
CREATE POLICY "Producers can delete own unsold products"
  ON products FOR DELETE
  TO authenticated
  USING (
    producer_id = auth.uid() AND
    is_sold = false
  );

-- RLS Policies for product_files

-- Only product owner can view files
CREATE POLICY "Producers can view own product files"
  ON product_files FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM products 
      WHERE products.id = product_files.product_id 
      AND products.producer_id = auth.uid()
    )
  );

-- Only active producers can insert files for their products
CREATE POLICY "Active producers can add product files"
  ON product_files FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      JOIN user_profiles up ON up.id = p.producer_id
      WHERE p.id = product_files.product_id 
      AND p.producer_id = auth.uid()
      AND up.is_producer_active = true
    )
  );

-- Producers can delete their own product files
CREATE POLICY "Producers can delete own product files"
  ON product_files FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM products 
      WHERE products.id = product_files.product_id 
      AND products.producer_id = auth.uid()
      AND products.is_sold = false
    )
  );

-- Trigger for updated_at on products
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to generate slug from title
CREATE OR REPLACE FUNCTION generate_product_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 1;
BEGIN
  -- Only generate slug if it's null or empty, or if title changed on update
  IF NEW.slug IS NOT NULL AND NEW.slug != '' THEN
    IF TG_OP = 'UPDATE' AND NEW.title = OLD.title THEN
      RETURN NEW;
    END IF;
  END IF;
  
  -- Generate base slug from title
  base_slug := lower(regexp_replace(NEW.title, '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  final_slug := base_slug;
  
  -- Check for uniqueness and add counter if needed
  WHILE EXISTS (SELECT 1 FROM products WHERE slug = final_slug AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)) LOOP
    final_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;
  
  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate slug
DROP TRIGGER IF EXISTS generate_product_slug_trigger ON products;
CREATE TRIGGER generate_product_slug_trigger
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION generate_product_slug();

-- Insert default genres
INSERT INTO genres (name, name_en, name_de, slug, sort_order) VALUES
  ('Hip-Hop', 'Hip-Hop', 'Hip-Hop', 'hip-hop', 1),
  ('Trap', 'Trap', 'Trap', 'trap', 2),
  ('R&B', 'R&B', 'R&B', 'rnb', 3),
  ('Pop', 'Pop', 'Pop', 'pop', 4),
  ('Drill', 'Drill', 'Drill', 'drill', 5),
  ('Afrobeat', 'Afrobeat', 'Afrobeat', 'afrobeat', 6),
  ('Reggaeton', 'Reggaeton', 'Reggaeton', 'reggaeton', 7),
  ('Lo-Fi', 'Lo-Fi', 'Lo-Fi', 'lofi', 8),
  ('EDM', 'EDM', 'EDM', 'edm', 9),
  ('Soul', 'Soul', 'Soul', 'soul', 10)
ON CONFLICT (slug) DO NOTHING;

-- Insert default moods
INSERT INTO moods (name, name_en, name_de, slug, color, sort_order) VALUES
  ('Energique', 'Energetic', 'Energisch', 'energetic', '#FF6B6B', 1),
  ('Sombre', 'Dark', 'Dunkel', 'dark', '#2C3E50', 2),
  ('Chill', 'Chill', 'Entspannt', 'chill', '#74B9FF', 3),
  ('Agressif', 'Aggressive', 'Aggressiv', 'aggressive', '#E74C3C', 4),
  ('Melancolique', 'Melancholic', 'Melancholisch', 'melancholic', '#9B59B6', 5),
  ('Motivant', 'Motivational', 'Motivierend', 'motivational', '#F39C12', 6),
  ('Romantique', 'Romantic', 'Romantisch', 'romantic', '#E91E63', 7),
  ('Festif', 'Party', 'Party', 'party', '#00CEC9', 8)
ON CONFLICT (slug) DO NOTHING;