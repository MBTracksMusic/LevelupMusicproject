-- Fix auth.uid() initplan: replace all direct auth.uid() calls in RLS policies
-- with (SELECT auth.uid()) so PostgreSQL evaluates it once per query, not per row.
-- Uses ALTER POLICY (no drop/recreate) for safety.

DO $$
DECLARE
  r      RECORD;
  new_qual  text;
  new_check text;
  sql    text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  (qual ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.uid()%')
  LOOP
    new_qual  := NULL;
    new_check := NULL;
    sql := 'ALTER POLICY ' || quote_ident(r.policyname)
        || ' ON public.' || quote_ident(r.tablename);

    IF r.qual IS NOT NULL AND r.qual ILIKE '%auth.uid()%' THEN
      new_qual := replace(r.qual, 'auth.uid()', '(SELECT auth.uid())');
      sql := sql || ' USING (' || new_qual || ')';
    END IF;

    IF r.with_check IS NOT NULL AND r.with_check ILIKE '%auth.uid()%' THEN
      new_check := replace(r.with_check, 'auth.uid()', '(SELECT auth.uid())');
      sql := sql || ' WITH CHECK (' || new_check || ')';
    END IF;

    EXECUTE sql;
    RAISE NOTICE 'Patched policy "%" on %', r.policyname, r.tablename;
  END LOOP;
END;
$$;
