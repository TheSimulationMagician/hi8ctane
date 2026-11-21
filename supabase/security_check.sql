-- Hi8ctane security check: paste into Supabase → SQL Editor → Run. It only reads; it changes nothing.
-- Every row is a problem to fix. "No rows returned" means the database is locked down the way the website expects:
-- the website can't read or change any table directly, only call the hi8_ functions, which check the rider's key.

with expected_public_functions(name) as (values
  -- what the website calls (with the publishable key); everything else must be server-only
  ('hi8_add_start'), ('hi8_alert'), ('hi8_alert_signup'), ('hi8_avatar_remove'), ('hi8_car_plan'), ('hi8_checkin'), ('hi8_city'),
  ('hi8_city_request'), ('hi8_counts'), ('hi8_crew'), ('hi8_crews'), ('hi8_join'), ('hi8_join_crew'), ('hi8_leave_crew'), ('hi8_live'),
  ('hi8_log_error'), ('hi8_me'), ('hi8_messages'), ('hi8_my_avatar'), ('hi8_paid'), ('hi8_partner'), ('hi8_pass_interest'), ('hi8_pay_seat'),
  ('hi8_places'), ('hi8_plan_interest'), ('hi8_plan_leave'), ('hi8_plans'), ('hi8_profile'), ('hi8_quick_join'), ('hi8_quick_start'),
  ('hi8_report'), ('hi8_rsvp'), ('hi8_send'), ('hi8_set_from'), ('hi8_settings'), ('hi8_settle'), ('hi8_start_crew'), ('hi8_unsubscribe'),
  ('hi8_waitlist'), ('hi8_wallet'),
  -- 2.20 who's looking, 2.22 crews that stay together
  ('hi8_look'), ('hi8_card'), ('hi8_squad'), ('hi8_squad_call'), ('hi8_squad_join'), ('hi8_squad_keep'), ('hi8_squad_leave'), ('hi8_squads'), ('hi8_watch'),
  -- 0019 (2.23): alerts, push, crews needing a minimum, moving a crew, rider profiles
  ('hi8_wind_alert'), ('hi8_wind_alerts'), ('hi8_push_sub'), ('hi8_push_unsub'), ('hi8_watchers'), ('hi8_crew_min'), ('hi8_move_crew'),
  ('hi8_rider_profile'), ('hi8_crew_people'), ('hi8_set_phone'), ('hi8_no_show'),
  -- 0020 (2.24): rider cards
  ('hi8_crew_cards'),
  -- 0023 (2.29): matching, "I'm looking"
  ('hi8_mates'), ('hi8_ask'), ('hi8_my_asks'), ('hi8_asks')
), problems(problem, object) as (
  -- 1. every table has row level security on
  select 'table without row level security', n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  -- 2. no policy lets the website's roles in (Hi8ctane uses none: all access goes through functions)
  select 'policy open to the website (' || p.cmd || ')', p.schemaname || '.' || p.tablename || ' · ' || p.policyname
  from pg_policies p
  where p.schemaname = 'public' and (p.roles && array['anon', 'authenticated', 'public']::name[])
  union all
  -- 3. no direct table, view or sequence permissions for the website's roles
  select 'website role can ' || lower(g.privilege_type) || ' directly', g.table_schema || '.' || g.table_name || ' (' || g.grantee || ')'
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
  union all
  select 'website role can use a sequence', n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S' and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'UPDATE'))
  union all
  -- 4. views run as their owner and skip row level security: none may be readable by the website
  --    (server-only report views, like hi8_looks_report, are fine while the website's roles can't select them)
  select 'view the website can read (bypasses row level security)', n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))
  union all
  -- 5. SECURITY DEFINER functions pin their search_path
  select 'SECURITY DEFINER function without a fixed search_path', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%')
  union all
  -- 6. the website can call only the expected hi8_ functions (anything new must be checked before it's opened up)
  select 'function the website can call that is not on the list', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
    and p.proname not in (select name from expected_public_functions)
  union all
  -- 7. settings the website can read hold no secrets
  select 'secret-looking setting readable by the website', s.key
  from public.app_settings s
  where s.public and s.key ~* '(secret|token|password|api_key|_key$|webhook)'
    -- (vapid_public is the PUBLIC half of the web push key pair: browsers need it; the private half is in app_secrets)
  union all
  -- 8. Storage: the avatars bucket is read-only to the world; nobody but the server can add, change or delete files
  select 'Storage policy lets the website ' || lower(p.cmd) || ' files', p.policyname
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (p.roles && array['anon', 'authenticated', 'public']::name[])
)
select problem, object from problems order by problem, object;
