/*
  # Restrict EXECUTE on sensitive SECURITY DEFINER purchase functions

  Hardening:
  - Revoke EXECUTE from PUBLIC, anon, authenticated
  - Grant EXECUTE only to service_role
*/

BEGIN;

REVOKE EXECUTE ON FUNCTION public.create_exclusive_lock(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_exclusive_lock(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_exclusive_lock(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_exclusive_lock(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) TO service_role;

/*
VERIFY (expected: all *_exec columns = false)
`PUBLIC` is a pseudo-role, so it cannot be passed as first arg to has_function_privilege(...).

SELECT
  has_function_privilege('anon', 'public.create_exclusive_lock(uuid, uuid, text)', 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', 'public.create_exclusive_lock(uuid, uuid, text)', 'EXECUTE') AS authenticated_exec,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = to_regprocedure('public.create_exclusive_lock(uuid, uuid, text)')
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_exec;

SELECT
  has_function_privilege('anon', 'public.complete_exclusive_purchase(uuid, uuid, text, text, integer)', 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', 'public.complete_exclusive_purchase(uuid, uuid, text, text, integer)', 'EXECUTE') AS authenticated_exec,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = to_regprocedure('public.complete_exclusive_purchase(uuid, uuid, text, text, integer)')
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_exec;

SELECT
  has_function_privilege('anon', 'public.complete_standard_purchase(uuid, uuid, text, text, integer, text)', 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', 'public.complete_standard_purchase(uuid, uuid, text, text, integer, text)', 'EXECUTE') AS authenticated_exec,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = to_regprocedure('public.complete_standard_purchase(uuid, uuid, text, text, integer, text)')
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_exec;
*/

COMMIT;
