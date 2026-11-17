-- 0018 (2.18, written as 0015): lock down what Supabase grants the website's roles by default.
--
-- Supabase gives anon and authenticated (the publishable key) ALL rights on every new table, sequence and function
-- in public. Hi8ctane never relies on that: every table has row level security with no policies, and every function
-- the website may call is granted by name. So:
--   1. the 7 ID sequences stop being usable by the website (they weren't reachable through the API, but now not at all);
--   2. from now on, new tables, sequences and functions start closed: a new function must be granted to anon on
--      purpose, and a new table can't be read even if someone forgets row level security.
-- Check the result any time with supabase/security_check.sql (no rows = locked down).
--
-- Safe to run more than once. Needs 0001 to 0017.

revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, public;
alter default privileges for role postgres revoke execute on functions from public;  -- Postgres's own default: everyone may run new functions
