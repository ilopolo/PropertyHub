-- Trusted psql connection only. Set auth_user_id to the EXACT operator-approved confirmed Auth UUID.
-- Example invocation: psql "$DATABASE_URL" -v auth_user_id=... -f supabase/operators/bootstrap-platform-admin.sql
-- No credentials in this file. No public RPC exists. Do not use a first-signup/email shortcut.
\set ON_ERROR_STOP on
begin;
select id, email_confirmed_at from auth.users where id = :'auth_user_id'::uuid;
select private.bootstrap_platform_admin(:'auth_user_id'::uuid) as platform_profile_id;
commit;
