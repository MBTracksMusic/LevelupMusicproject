-- Drop 6 unused duplicate indexes
DROP INDEX IF EXISTS idx_products_producer;
DROP INDEX IF EXISTS idx_battles_producer1_created_at;
DROP INDEX IF EXISTS settings_expr_idx;
DROP INDEX IF EXISTS one_row_settings;
DROP INDEX IF EXISTS idx_stripe_events_processed_processing_started_at;
DROP INDEX IF EXISTS idx_fraud_events_event_created_desc;

-- Add missing FK indexes
CREATE INDEX IF NOT EXISTS idx_entitlements_purchase_id ON entitlements(purchase_id);
CREATE INDEX IF NOT EXISTS idx_products_sold_to_user_id ON products(sold_to_user_id);
CREATE INDEX IF NOT EXISTS idx_battle_votes_voted_for_producer_id ON battle_votes(voted_for_producer_id);
CREATE INDEX IF NOT EXISTS idx_battles_winner_id ON battles(winner_id);
CREATE INDEX IF NOT EXISTS idx_download_logs_product_id ON download_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_user_id ON entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_battle_product_snapshots_producer_id ON battle_product_snapshots(producer_id);
