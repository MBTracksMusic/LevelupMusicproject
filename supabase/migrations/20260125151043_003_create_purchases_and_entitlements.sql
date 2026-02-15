/*
  # LevelupMusic - Purchases and Entitlements Schema

  1. Overview
    This migration creates the purchase tracking and entitlement system.
    All purchases are created server-side via Stripe webhooks.

  2. New Tables
    - `purchases`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - Buyer
      - `product_id` (uuid) - Purchased product
      - `producer_id` (uuid) - Seller (denormalized for performance)
      - `stripe_payment_intent_id` (text) - Stripe payment reference
      - `stripe_checkout_session_id` (text) - Checkout session reference
      - `amount` (integer) - Amount paid in cents
      - `currency` (text) - Currency code
      - `status` (enum) - Payment status
      - `license_type` (text) - Type of license purchased
      - `is_exclusive` (boolean) - Was this an exclusive purchase
      - `download_count` (integer) - Number of times downloaded
      - `max_downloads` (integer) - Maximum allowed downloads
      - `download_expires_at` (timestamptz) - Download link expiration
      - `created_at` (timestamptz)

    - `entitlements`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - User with access
      - `product_id` (uuid) - Product they can access
      - `purchase_id` (uuid) - Related purchase
      - `entitlement_type` (enum) - Type of access
      - `granted_at` (timestamptz) - When access was granted
      - `expires_at` (timestamptz) - When access expires (if applicable)
      - `is_active` (boolean) - Current status

    - `exclusive_locks`
      - `id` (uuid, primary key)
      - `product_id` (uuid) - Product being locked
      - `user_id` (uuid) - User who initiated checkout
      - `stripe_checkout_session_id` (text) - Session ID
      - `locked_at` (timestamptz) - When lock was created
      - `expires_at` (timestamptz) - Lock expiration (15 minutes)

  3. Security
    - RLS enabled on all tables
    - Users can only view their own purchases
    - Producers can view sales of their products
    - Entitlements determine file access

  4. Important Notes
    - Purchases are ONLY created via Stripe webhooks
    - Exclusive locks prevent double-purchase
    - Download counts are tracked and limited
*/

-- Create enum for purchase status
DO $$ BEGIN
  CREATE TYPE purchase_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create enum for entitlement type
DO $$ BEGIN
  CREATE TYPE entitlement_type AS ENUM ('purchase', 'subscription', 'promo', 'admin_grant');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create purchases table
CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  stripe_payment_intent_id text UNIQUE,
  stripe_checkout_session_id text UNIQUE,
  amount integer NOT NULL CHECK (amount >= 0),
  currency text DEFAULT 'eur' NOT NULL,
  status purchase_status DEFAULT 'pending' NOT NULL,
  license_type text DEFAULT 'standard',
  is_exclusive boolean DEFAULT false NOT NULL,
  download_count integer DEFAULT 0 NOT NULL,
  max_downloads integer DEFAULT 5 NOT NULL,
  download_expires_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now() NOT NULL,
  completed_at timestamptz
);

-- Create entitlements table
CREATE TABLE IF NOT EXISTS entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  entitlement_type entitlement_type NOT NULL,
  granted_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz,
  is_active boolean DEFAULT true NOT NULL,
  
  CONSTRAINT unique_user_product_entitlement UNIQUE (user_id, product_id)
);

-- Create exclusive_locks table for preventing double-purchase of exclusives
CREATE TABLE IF NOT EXISTS exclusive_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  stripe_checkout_session_id text NOT NULL,
  locked_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  
  CONSTRAINT unique_product_lock UNIQUE (product_id)
);

-- Create download_logs table for audit
CREATE TABLE IF NOT EXISTS download_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  ip_address inet,
  user_agent text,
  downloaded_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_producer ON purchases(producer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
CREATE INDEX IF NOT EXISTS idx_purchases_stripe_pi ON purchases(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_purchases_stripe_session ON purchases(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_product ON entitlements(product_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_active ON entitlements(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_exclusive_locks_product ON exclusive_locks(product_id);
CREATE INDEX IF NOT EXISTS idx_exclusive_locks_expires ON exclusive_locks(expires_at);

CREATE INDEX IF NOT EXISTS idx_download_logs_user ON download_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_download_logs_purchase ON download_logs(purchase_id);

-- Enable RLS
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE exclusive_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for purchases

-- Users can view their own purchases
CREATE POLICY "Users can view own purchases"
  ON purchases FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Producers can view purchases of their products
CREATE POLICY "Producers can view sales of their products"
  ON purchases FOR SELECT
  TO authenticated
  USING (producer_id = auth.uid());

-- RLS Policies for entitlements

-- Users can view their own entitlements
CREATE POLICY "Users can view own entitlements"
  ON entitlements FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for exclusive_locks

-- Users can view locks they created
CREATE POLICY "Users can view own locks"
  ON exclusive_locks FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for download_logs

-- Users can view their own download history
CREATE POLICY "Users can view own download logs"
  ON download_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Function to clean up expired exclusive locks
CREATE OR REPLACE FUNCTION cleanup_expired_exclusive_locks()
RETURNS void AS $$
BEGIN
  DELETE FROM exclusive_locks WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create exclusive lock (called server-side before checkout)
CREATE OR REPLACE FUNCTION create_exclusive_lock(
  p_product_id uuid,
  p_user_id uuid,
  p_checkout_session_id text
)
RETURNS boolean AS $$
DECLARE
  v_is_sold boolean;
  v_existing_lock exclusive_locks%ROWTYPE;
BEGIN
  -- First, clean up expired locks
  PERFORM cleanup_expired_exclusive_locks();
  
  -- Check if product is already sold
  SELECT is_sold INTO v_is_sold FROM products WHERE id = p_product_id;
  IF v_is_sold THEN
    RETURN false;
  END IF;
  
  -- Check for existing lock
  SELECT * INTO v_existing_lock FROM exclusive_locks WHERE product_id = p_product_id;
  IF FOUND AND v_existing_lock.expires_at > now() THEN
    -- Lock exists and is not expired
    RETURN false;
  END IF;
  
  -- Delete any existing expired lock and create new one
  DELETE FROM exclusive_locks WHERE product_id = p_product_id;
  
  INSERT INTO exclusive_locks (product_id, user_id, stripe_checkout_session_id)
  VALUES (p_product_id, p_user_id, p_checkout_session_id);
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to complete exclusive purchase (called by webhook)
CREATE OR REPLACE FUNCTION complete_exclusive_purchase(
  p_product_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount integer
)
RETURNS uuid AS $$
DECLARE
  v_purchase_id uuid;
  v_producer_id uuid;
  v_lock exclusive_locks%ROWTYPE;
BEGIN
  -- Verify lock exists and matches
  SELECT * INTO v_lock FROM exclusive_locks 
  WHERE product_id = p_product_id 
  AND stripe_checkout_session_id = p_checkout_session_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No valid lock found for this purchase';
  END IF;
  
  -- Get producer ID
  SELECT producer_id INTO v_producer_id FROM products WHERE id = p_product_id;
  
  -- Create purchase record
  INSERT INTO purchases (
    user_id, product_id, producer_id, 
    stripe_payment_intent_id, stripe_checkout_session_id,
    amount, status, is_exclusive, completed_at,
    download_expires_at
  ) VALUES (
    p_user_id, p_product_id, v_producer_id,
    p_payment_intent_id, p_checkout_session_id,
    p_amount, 'completed', true, now(),
    now() + interval '24 hours'
  ) RETURNING id INTO v_purchase_id;
  
  -- Create entitlement
  INSERT INTO entitlements (user_id, product_id, purchase_id, entitlement_type)
  VALUES (p_user_id, p_product_id, v_purchase_id, 'purchase')
  ON CONFLICT (user_id, product_id) DO UPDATE SET
    purchase_id = EXCLUDED.purchase_id,
    is_active = true,
    granted_at = now();
  
  -- Mark product as sold
  UPDATE products SET
    is_sold = true,
    sold_at = now(),
    sold_to_user_id = p_user_id,
    is_published = false
  WHERE id = p_product_id;
  
  -- Remove lock
  DELETE FROM exclusive_locks WHERE product_id = p_product_id;
  
  -- Increment user's purchase count
  UPDATE user_profiles SET
    total_purchases = total_purchases + 1
  WHERE id = p_user_id;
  
  RETURN v_purchase_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to complete standard purchase (called by webhook)
CREATE OR REPLACE FUNCTION complete_standard_purchase(
  p_product_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount integer,
  p_license_type text DEFAULT 'standard'
)
RETURNS uuid AS $$
DECLARE
  v_purchase_id uuid;
  v_producer_id uuid;
BEGIN
  -- Get producer ID
  SELECT producer_id INTO v_producer_id FROM products WHERE id = p_product_id;
  
  -- Create purchase record
  INSERT INTO purchases (
    user_id, product_id, producer_id,
    stripe_payment_intent_id, stripe_checkout_session_id,
    amount, status, is_exclusive, license_type, completed_at,
    download_expires_at
  ) VALUES (
    p_user_id, p_product_id, v_producer_id,
    p_payment_intent_id, p_checkout_session_id,
    p_amount, 'completed', false, p_license_type, now(),
    now() + interval '7 days'
  ) RETURNING id INTO v_purchase_id;
  
  -- Create entitlement
  INSERT INTO entitlements (user_id, product_id, purchase_id, entitlement_type)
  VALUES (p_user_id, p_product_id, v_purchase_id, 'purchase')
  ON CONFLICT (user_id, product_id) DO UPDATE SET
    purchase_id = EXCLUDED.purchase_id,
    is_active = true,
    granted_at = now();
  
  -- Increment user's purchase count
  UPDATE user_profiles SET
    total_purchases = total_purchases + 1
  WHERE id = p_user_id;
  
  RETURN v_purchase_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has entitlement
CREATE OR REPLACE FUNCTION user_has_entitlement(p_user_id uuid, p_product_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM entitlements 
    WHERE user_id = p_user_id 
    AND product_id = p_product_id 
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;