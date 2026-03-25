/*
  # Cleanup Stripe data on user account deletion

  Goals:
  - Clear Stripe Connect data when user is deleted
  - Prevent orphaned stripe_account_id records
  - Allow new users to reuse the same email without conflicts

  Strategy:
  - PostgreSQL trigger on auth.users DELETE
  - Automatically clears stripe_account_id and related fields
  - Preserves audit trail (doesn't delete records, just nullifies Stripe fields)
*/

BEGIN;

-- Function to cleanup Stripe data when user is deleted
CREATE OR REPLACE FUNCTION public.cleanup_stripe_on_user_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Clear Stripe Connect data from user_profiles
  UPDATE public.user_profiles
  SET
    stripe_account_id = NULL,
    stripe_account_charges_enabled = FALSE,
    stripe_account_details_submitted = FALSE,
    stripe_account_created_at = NULL
  WHERE id = OLD.id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users deletion
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_stripe_on_user_delete();

COMMIT;
