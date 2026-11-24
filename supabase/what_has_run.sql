-- Which database updates (migrations 0013 to 0026) has this Supabase project had?
-- Paste into Supabase > SQL Editor and press Run. It only reads; it changes nothing.
-- Every "no" is a file to run, in number order, from supabase/migrations/.
select m.file, case when m.done then 'yes' else 'NO: run it' end as has_run
from (values
  ('0013_nl_days_out.sql',   exists (select 1 from public.plans where slug = 'schoorl-mtb-day')),
  ('0014_looking.sql',       to_regclass('public.looks') is not null),
  ('0015_my_crew.sql',       to_regclass('public.squads') is not null),
  ('0016_audit_fixes.sql',   exists (select 1 from information_schema.columns where table_schema = 'public' and column_name = 'is_test')),
  ('0017_cartoons.sql',      to_regclass('public.rider_avatars') is not null),
  ('0018_lockdown.sql',      exists (select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' and d.defaclobjtype = 'f')),
  ('0019_alerts_push.sql',   to_regclass('public.wind_alerts') is not null),
  ('0020_rider_cards.sql',   exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'signups' and column_name = 'card_public')),
  ('0021_alerts_cron.sql',   to_regclass('public.fx_cache') is not null),
  ('0022_one_letter.sql',    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'hi8_crew_cards' and p.prosrc like '%c.city), 1)%')),
  ('0023_matching.sql',      to_regclass('public.ride_asks') is not null),
  ('0024_session_plan.sql',  to_regprocedure('public.hi8_crew_base(text, uuid)') is not null),
  ('0025_keys.sql',          to_regprocedure('public.hi8_join_v1(text, text, text, text)') is not null),
  ('0026_metrics.sql',       to_regclass('public.events') is not null)
) as m(file, done)
order by m.file;
