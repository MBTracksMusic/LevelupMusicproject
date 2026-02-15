/*
  # Fix signup failure due to RLS on user_profiles

  The trigger handle_new_user() inserts a row in user_profiles after auth signup.
  Because RLS is enabled and no INSERT policy existed, the Supabase auth service
  role (supabase_auth_admin) was blocked, returning "Database error saving new user".

  This migration allows the auth backend (and the service role) to insert rows,
  and also lets authenticated users insert their own profile if needed.
*/

-- Allow Supabase auth backend + service role to insert profile rows
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where policyname = 'Auth service can insert profiles'
      and tablename = 'user_profiles'
      and schemaname = 'public'
  ) then
    create policy "Auth service can insert profiles"
      on public.user_profiles
      for insert
      to supabase_auth_admin, service_role
      with check (true);
  end if;
end$$;

-- Allow authenticated users to insert their own profile (optional safeguard)
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where policyname = 'Authenticated can insert own profile'
      and tablename = 'user_profiles'
      and schemaname = 'public'
  ) then
    create policy "Authenticated can insert own profile"
      on public.user_profiles
      for insert
      to authenticated
      with check (auth.uid() = id);
  end if;
end$$;
