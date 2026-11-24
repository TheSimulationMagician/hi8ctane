-- Hi8ctane 0025: nobody gets another rider's key by typing their email (P0-1, 2.31).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0024. Safe to run again.
--
-- Until now the join form gave a working key for ANY email, including one that already belongs to a rider: whoever
-- typed it could see that rider's crews (the exact pin, names, chat) and act as them. Now:
--   * a NEW email still gets a key straight away (a first join stays one step);
--   * an email we already know gets no key: the site emails a sign-in link (Supabase Auth, as the join page
--     already does), and the key comes from hi8_claim once the link is opened on the phone;
--   * signing in with the link (or Google) removes the older keys made by just typing that email.
-- Switch: app_settings 'strict_keys' (true by default). To turn it off at once:
--   update public.app_settings set value = 'false' where key = 'strict_keys';
-- Way back: run the line above, then  drop function public.hi8_join(text, text, text, text);
--   alter function public.hi8_join_v1(text, text, text, text) rename to hi8_join;
--   grant execute on function public.hi8_join(text, text, text, text) to anon, authenticated;
-- (hi8_quick_join and hi8_claim keep working either way: the lines this adds only act on needs_link.)
--
-- Needs: Supabase > Authentication > URL Configuration lets the link come back to https://hi8ctane.com/** .

insert into public.app_settings (key, value, public) values ('strict_keys', 'true', false) on conflict (key) do nothing;

-- the previous hi8_join stays, renamed, as the way back
do $$ begin
  if to_regprocedure('public.hi8_join_v1(text, text, text, text)') is null then
    alter function public.hi8_join(text, text, text, text) rename to hi8_join_v1;
  end if;
end $$;
revoke execute on function public.hi8_join_v1(text, text, text, text) from public, anon, authenticated;

-- is this email already a rider (a key was made for it, or it signed in for real)?
create or replace function public.hi8_known_email(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rider_keys where lower(email) = lower(trim(p_email)))
      or exists (select 1 from public.signups where lower(email) = lower(trim(p_email)) and email_verified_at is not null);
$$;
revoke execute on function public.hi8_known_email(text) from public, anon, authenticated;

create or replace function public.hi8_join(p_email text, p_city text default 'amsterdam', p_source text default null, p_ref text default null) returns json
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email, ''))); r json;
begin
  if coalesce((select value from public.app_settings where key = 'strict_keys'), 'true'::jsonb) = 'false'::jsonb or not public.hi8_known_email(em) then
    return public.hi8_join_v1(p_email, p_city, p_source, p_ref);
  end if;
  -- a rider we know: keep what they asked for (the city list), but no key; the site sends a sign-in link
  if char_length(em) > 254 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_email' using errcode = '22023', hint = 'That email doesn''t look right.';
  end if;
  perform public.hi8_limit('join', public.hi8_client(), 20, interval '10 minutes');
  perform public.hi8_limit('join', 'everyone', 3000, interval '1 hour');
  r := public.join_waitlist(p_city => coalesce(nullif(lower(trim(p_city)), ''), 'amsterdam'), p_first_name => null, p_email => em,
                            p_source => left(nullif(trim(p_source), ''), 80), p_ref => left(nullif(trim(p_ref), ''), 40));
  return (r::jsonb || jsonb_build_object('needs_link', true, 'existing', true))::json;
end $$;
revoke execute on function public.hi8_join(text, text, text, text) from public;
grant execute on function public.hi8_join(text, text, text, text) to anon, authenticated;

-- the one-step sign-ups (join a crew from its link, start a crew, turn on alerts) stop on a known email too;
-- the site then sends the link
do $$
declare f text; def text;
begin
  foreach f in array array['hi8_quick_join', 'hi8_quick_start', 'hi8_alert_signup'] loop
    select pg_get_functiondef(oid) into def from pg_proc where proname = f and pronamespace = 'public'::regnamespace;
    if def is not null and position('needs_link' in def) = 0 and position('k := (j->>''key'')::uuid;' in def) > 0 then
      def := replace(def, 'k := (j->>''key'')::uuid;',
        'if coalesce((j->>''needs_link'')::boolean, false) then raise exception ''needs_link'' using errcode = ''22023'', hint = ''You''''ve joined before: we emailed you a sign-in link. Open it on this phone and you''''re back here, signed in.''; end if;' || chr(10) || '  k := (j->>''key'')::uuid;');
      execute def;
    end if;
  end loop;
end $$;

-- signing in for real removes the keys made by just typing this email (an old phone signs in again)
do $$
declare def text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'hi8_claim' and pronamespace = 'public'::regnamespace;
  if def is not null and position('how = ''form''' in def) = 0 then
    def := replace(def, 'returning key into k;',
      'returning key into k;' || chr(10) || '  delete from public.rider_keys where lower(email) = em and how = ''form'';');
    execute def;
  end if;
end $$;

-- check: five yes
select 'hi8_join asks known emails to sign in' as what, position('needs_link' in pg_get_functiondef('public.hi8_join(text, text, text, text)'::regprocedure)) > 0 as ok
union all select p.proname || ' stops on needs_link', position('needs_link' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname in ('hi8_quick_join', 'hi8_quick_start', 'hi8_alert_signup')
union all select 'hi8_claim removes typed-email keys', position('how = ''form''' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'hi8_claim';

notify pgrst, 'reload schema';
