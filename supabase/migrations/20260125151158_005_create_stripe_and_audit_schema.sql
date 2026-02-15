/*
  # LevelupMusic - Stripe Events and Audit Logging Schema

  1. Overview
    This migration creates the Stripe webhook handling and audit logging system.
    All Stripe events are logged for idempotency and compliance.

  2. New Tables
    - `stripe_events`
      - `id` (text, primary key) - Stripe event ID
      - `type` (text) - Event type (checkout.session.completed, etc.)
      - `data` (jsonb) - Full event payload
      - `processed` (boolean) - Whether event was processed
      - `processed_at` (timestamptz) - When processing completed
      - `error` (text) - Any error during processing
      - `created_at` (timestamptz)

    - `audit_logs`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - User who performed action
      - `action` (text) - Action performed
      - `resource_type` (text) - Type of resource affected
      - `resource_id` (uuid) - ID of affected resource
      - `old_values` (jsonb) - Previous values
      - `new_values` (jsonb) - New values
      - `ip_address` (inet) - Client IP
      - `user_agent` (text) - Client user agent
      - `created_at` (timestamptz)

    - `preview_access_logs`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - User who accessed preview
      - `product_id` (uuid) - Product preview accessed
      - `preview_type` (text) - standard or exclusive
      - `ip_address` (inet)
      - `created_at` (timestamptz)

    - `cart_items`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - Cart owner
      - `product_id` (uuid) - Product in cart
      - `created_at` (timestamptz)

    - `wishlists`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - Wishlist owner
      - `product_id` (uuid) - Wishlisted product
      - `created_at` (timestamptz)

  3. Security
    - RLS enabled on all tables
    - Stripe events are server-only
    - Audit logs are read-only for users
    - Users can manage their own cart and wishlist

  4. Important Notes
    - stripe_events ensures webhook idempotency
    - Audit logs provide compliance trail
    - Preview access is tracked for abuse detection
*/

-- Create stripe_events table for webhook idempotency
CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  data jsonb NOT NULL,
  processed boolean DEFAULT false NOT NULL,
  processed_at timestamptz,
  error text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create preview_access_logs table
CREATE TABLE IF NOT EXISTS preview_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  preview_type text NOT NULL CHECK (preview_type IN ('standard', 'exclusive')),
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create cart_items table
CREATE TABLE IF NOT EXISTS cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  license_type text DEFAULT 'standard',
  created_at timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT unique_cart_item UNIQUE (user_id, product_id)
);

-- Create wishlists table
CREATE TABLE IF NOT EXISTS wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT unique_wishlist_item UNIQUE (user_id, product_id)
);

-- Create producer_stats view for analytics
CREATE OR REPLACE VIEW producer_stats AS
SELECT 
  p.producer_id,
  COUNT(DISTINCT p.id) AS total_products,
  COUNT(DISTINCT p.id) FILTER (WHERE p.is_published = true) AS published_products,
  COUNT(DISTINCT pur.id) AS total_sales,
  COALESCE(SUM(pur.amount) FILTER (WHERE pur.status = 'completed'), 0) AS total_revenue,
  COALESCE(SUM(p.play_count), 0) AS total_plays
FROM products p
LEFT JOIN purchases pur ON pur.product_id = p.id
GROUP BY p.producer_id;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON stripe_events(processed) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_stripe_events_created ON stripe_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_preview_access_user ON preview_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_preview_access_product ON preview_access_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_preview_access_created ON preview_access_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items(product_id);

CREATE INDEX IF NOT EXISTS idx_wishlists_user ON wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_product ON wishlists(product_id);

-- Enable RLS
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE preview_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;

-- RLS Policies for audit_logs
-- Users can view audit logs related to their own actions
CREATE POLICY "Users can view own audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for preview_access_logs
-- Users can view their own access logs
CREATE POLICY "Users can view own preview access logs"
  ON preview_access_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for cart_items
CREATE POLICY "Users can view own cart"
  ON cart_items FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can add to cart"
  ON cart_items FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM products 
      WHERE id = cart_items.product_id 
      AND is_published = true
      AND (is_exclusive = false OR is_sold = false)
    )
  );

CREATE POLICY "Users can remove from cart"
  ON cart_items FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for wishlists
CREATE POLICY "Users can view own wishlist"
  ON wishlists FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can add to wishlist"
  ON wishlists FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can remove from wishlist"
  ON wishlists FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Function to check stripe event idempotency
CREATE OR REPLACE FUNCTION check_stripe_event_processed(p_event_id text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM stripe_events WHERE id = p_event_id AND processed = true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark stripe event as processed
CREATE OR REPLACE FUNCTION mark_stripe_event_processed(p_event_id text, p_error text DEFAULT NULL)
RETURNS void AS $$
BEGIN
  UPDATE stripe_events SET
    processed = true,
    processed_at = now(),
    error = p_error
  WHERE id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log audit event
CREATE OR REPLACE FUNCTION log_audit_event(
  p_user_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid DEFAULT NULL,
  p_old_values jsonb DEFAULT NULL,
  p_new_values jsonb DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO audit_logs (
    user_id, action, resource_type, resource_id,
    old_values, new_values, ip_address, user_agent, metadata
  ) VALUES (
    p_user_id, p_action, p_resource_type, p_resource_id,
    p_old_values, p_new_values, p_ip_address, p_user_agent, p_metadata
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log preview access
CREATE OR REPLACE FUNCTION log_preview_access(
  p_user_id uuid,
  p_product_id uuid,
  p_preview_type text,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO preview_access_logs (user_id, product_id, preview_type, ip_address, user_agent)
  VALUES (p_user_id, p_product_id, p_preview_type, p_ip_address, p_user_agent);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user can access exclusive preview
CREATE OR REPLACE FUNCTION can_access_exclusive_preview(p_user_id uuid)
RETURNS boolean AS $$
DECLARE
  v_role user_role;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  
  SELECT role INTO v_role FROM user_profiles WHERE id = p_user_id;
  RETURN v_role IN ('confirmed_user', 'producer', 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment play count
CREATE OR REPLACE FUNCTION increment_play_count(p_product_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE products SET play_count = play_count + 1 WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;