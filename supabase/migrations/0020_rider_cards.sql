-- Hi8ctane 0020: rider cards (2.24). See who you'd ride with before you join.
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0019. Safe to run again.
--
-- Every rider in a crew has a card: their level, how long they've ridden, their home spot, a line about themselves,
-- and what they've ridden (sessions, spots, drives, crews started, since when). Who sees what:
--   * anyone looking at a crew (before joining): the card with their cartoon (the selfie drawn as a salty surf
--     cartoon, never the photo), plate, level, the numbers, years riding, home spot and their line, but WITHOUT the
--     name or Instagram. A signed-in rider also sees how often they've ridden with each one. (Names, cars and the
--     chat stay for the crew; the captain's name was already on every crew.)
--   * the riders in that crew: the whole card, with the name and Instagram (phones stay in hi8_crew_people).
-- Each rider decides who sees their card (signups.card_public): true = riders deciding to join see it (as above),
-- false = "only my crews": outside their crews, only initials and level. Until a rider has chosen (null), the card
-- is treated as "only my crews": nobody's card is opened for them.

alter table public.signups add column if not exists tagline text check (tagline is null or char_length(tagline) <= 70);
alter table public.signups add column if not exists card_public boolean;
alter table public.signups alter column card_public drop not null;
alter table public.signups alter column card_public drop default;

-- one rider's numbers (only sessions that happened: the crew was on and is over, and they weren't marked no-show)
create or replace function public.hi8_rider_stats(p_email text) returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.*, m.getting from public.crews c join public.crew_members m on m.crew_id = c.id
    where lower(m.email) = lower(p_email) and c.status = 'on' and public.hi8_crew_past(c) and not m.no_show)
  select jsonb_build_object(
    'sessions', (select count(*) from mine),
    'spots', (select count(distinct spot) from mine),
    'drives', (select count(*) from mine where getting = 'drive'),
    'started', (select count(*) from mine where lower(host_email) = lower(p_email)),
    'since', (select to_char(min(created_at), 'YYYY-MM') from public.signups where lower(email) = lower(p_email)),
    'top_spot', (select s.name from mine x join public.spots s on s.slug = x.spot group by s.name order by count(*) desc, s.name limit 1));
$$;

-- the cards of everyone in a crew. p_key is optional: without it you get the public part.
create or replace function public.hi8_crew_cards(p_code text, p_key uuid default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  c public.crews;
  em text;
  inside boolean := false;
begin
  perform public.hi8_limit('cards', coalesce(p_key::text, public.hi8_client(), 'none'), 120, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if p_key is not null then
    begin em := public.hi8_email(p_key); exception when others then em := null; end;
  end if;
  inside := em is not null and exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em);
  return (select coalesce(json_agg(card order by joined_at), '[]'::json) from (
    select m.joined_at, jsonb_strip_nulls(jsonb_build_object(
      'member_id', m.member_id,
      'name', case when inside or lower(m.email) = lower(c.host_email) then public.hi8_name(m.email, c.city) end,
      'initials', upper(left(public.hi8_name(m.email, c.city), 2)),
      'plate', case when coalesce(p.card_public, false) or inside then public.hi8_plate(m.email, c.city) end,
      'avatar', case when coalesce(p.card_public, false) or inside then public.hi8_avatar(m.email) end,
      'level', m.level,
      'host', lower(m.email) = lower(c.host_email),
      'me', em is not null and lower(m.email) = em,
      'open', coalesce(p.card_public, false),
      'made', p.card_public is not null,
      'stats', case when coalesce(p.card_public, false) or inside then public.hi8_rider_stats(m.email) end,
      'years', case when coalesce(p.card_public, false) or inside then p.years_riding end,
      'home', case when coalesce(p.card_public, false) or inside then (select name from public.spots where slug = p.home_spot) end,
      'tagline', case when coalesce(p.card_public, false) or inside then p.tagline end,
      'insta', case when inside then p.insta end,
      'together', case when em is not null and lower(m.email) <> em then (
        select count(*) from public.crews x
        join public.crew_members a on a.crew_id = x.id and lower(a.email) = em and not a.no_show
        join public.crew_members b on b.crew_id = x.id and lower(b.email) = lower(m.email) and not b.no_show
        where x.status = 'on' and public.hi8_crew_past(x) and x.id <> c.id) end
    )) as card
    from public.crew_members m
    left join lateral (select * from public.signups s where lower(s.email) = lower(m.email) order by (s.city = c.city) desc, s.created_at limit 1) p on true
    where m.crew_id = c.id) z);
end $$;

-- the profile (from 0019) also keeps the line about yourself and whether your card is open
drop function if exists public.hi8_rider_profile(uuid, boolean, int, text, text);
create or replace function public.hi8_rider_profile(p_key uuid, p_save boolean default false, p_years int default null, p_home_spot text default null,
  p_insta text default null, p_tagline text default null, p_card_public boolean default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  em text := public.hi8_email(p_key);
  ig text := nullif(regexp_replace(trim(coalesce(p_insta, '')), '^@|^https?://(www\.)?instagram\.com/|/$', '', 'g'), '');
  tl text := nullif(left(regexp_replace(trim(coalesce(p_tagline, '')), '[[:cntrl:]]', '', 'g'), 70), '');
begin
  if p_save then
    perform public.hi8_limit('profile', p_key::text, 20, interval '10 minutes');
    if p_years is not null and (p_years < 0 or p_years > 60) then raise exception 'bad_years' using errcode = '22023', hint = 'Years riding: 0 to 60.'; end if;
    if p_home_spot is not null and not exists (select 1 from public.spots where slug = p_home_spot) then raise exception 'no_spot' using errcode = '22023'; end if;
    if ig is not null and ig !~ '^[A-Za-z0-9._]{1,30}$' then raise exception 'bad_insta' using errcode = '22023', hint = 'Just the Instagram name, like hi8ctane.'; end if;
    if tl ~* '(https?://|www\.|[a-z0-9-]+\.(com|nl|es|net|org|me|io|app|co|ly|link|gg)(/|\M)|@[a-z0-9_.]{2,}|\+?[0-9][0-9 ]{7,})' then raise exception 'bad_tagline' using errcode = '22023', hint = 'No links, handles or numbers in your line: Instagram has its own box.'; end if;
    update public.signups set years_riding = p_years, home_spot = p_home_spot, insta = ig, tagline = tl,
      card_public = coalesce(p_card_public, card_public) where lower(email) = em;
    if p_card_public is null and not exists (select 1 from public.signups where lower(email) = em and card_public is not null) then
      raise exception 'pick_who' using errcode = '22023', hint = 'Choose who sees your card.';
    end if;
  end if;
  return (select json_build_object('years', s.years_riding, 'home_spot', s.home_spot, 'insta', s.insta, 'tagline', s.tagline,
            'card_public', s.card_public, 'rode', public.hi8_rode(em), 'stats', public.hi8_rider_stats(em))
          from public.signups s where lower(s.email) = em order by s.created_at limit 1);
end $$;

-- the crew's people (from 0019) also carry the line about themselves
create or replace function public.hi8_crew_people(p_key uuid, p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; boss boolean;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if not exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) then raise exception 'not_in_crew' using errcode = '42501'; end if;
  boss := lower(c.host_email) = em or public.hi8_is_captain(em);
  return (select coalesce(json_agg(json_build_object('member_id', m.member_id,
      'years', p.years_riding, 'home_spot', p.home_spot, 'home_spot_name', (select name from public.spots where slug = p.home_spot), 'insta', p.insta, 'tagline', p.tagline,
      'rode', public.hi8_rode(m.email), 'phone', m.phone, 'no_show', case when boss then m.no_show end,
      'no_shows', case when boss then (select count(*) from public.crew_members z where lower(z.email) = lower(m.email) and z.no_show) end)
      order by m.joined_at), '[]'::json)
    from public.crew_members m
    left join lateral (select * from public.signups s where lower(s.email) = lower(m.email) order by (s.city = c.city) desc, s.created_at limit 1) p on true
    where m.crew_id = c.id);
end $$;

revoke execute on function public.hi8_rider_stats(text) from public, anon, authenticated;
revoke execute on function public.hi8_crew_cards(text, uuid) from public;
revoke execute on function public.hi8_rider_profile(uuid, boolean, int, text, text, text, boolean) from public;
revoke execute on function public.hi8_crew_people(uuid, text) from public;
grant execute on function public.hi8_crew_cards(text, uuid) to anon, authenticated;
grant execute on function public.hi8_rider_profile(uuid, boolean, int, text, text, text, boolean) to anon, authenticated;
grant execute on function public.hi8_crew_people(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
