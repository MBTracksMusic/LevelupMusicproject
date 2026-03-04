/*
  # Trigger-only profile creation for public.user_profiles

  Rationale:
  - Signup profile creation is handled by trigger: on_auth_user_created -> handle_new_user().
  - No runtime insert/upsert into user_profiles is used by app code.
  - Remove authenticated client INSERT policy to reduce attack surface.

  Manual checklist after migration:
  - Sign up a new user -> verify a row exists in public.user_profiles.
  - Login with that user -> profile fetch works.
  - Update settings social links -> update still works.
  - Run checkout flow -> stripe_customer_id still updates.
*/

DROP POLICY IF EXISTS "Authenticated can insert own profile safely" ON public.user_profiles;
