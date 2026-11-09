-- Hi8ctane 0010: Tarifa opens, Tatajuba is coming soon, and trips (2.12).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0009. Safe to run again.
--
--   * Tarifa is a live region: its spots (Los Lances, Valdevaqueros, El Palmar, Alcornocales) get crews, with
--     pick-ups in Tarifa town, Algeciras and Cádiz. Riders can still start from any town within reach.
--   * Tatajuba (Ceará, Brazil) is "coming soon": riders join its list from the website (hi8_waitlist).
--   * A plan can be a trip (plans.trip). Trips from every region show in "Where next?" on the website, so
--     kite-trip operators can list theirs. Add one: Table Editor > plans > Insert row, with trip = true.

-- Tarifa: open, with its region name and pick-up points
update public.cities set status = 'open', region = coalesce(region, 'Tarifa') where slug = 'tarifa';
insert into public.hubs (city, slug, name, sub, lat, lon, sort, kind) values
  ('tarifa', 'town',  'TARIFA',    'TARIFA TOWN',       36.0143, -5.6044, 1, 'hub'),
  ('tarifa', 'alg',   'ALGECIRAS', 'ALGECIRAS STATION', 36.1290, -5.4535, 2, 'hub'),
  ('tarifa', 'cadiz', 'CÁDIZ',     'CÁDIZ STATION',     36.5292, -6.2894, 3, 'hub')
on conflict (city, slug) do nothing;
update public.spots set lat = 36.031, lon = -5.623,
  note = 'Long beach west of town. In summer, kite only in the marked zones. Strong Levante gets gusty: know your limits.', maps = 'Playa de Los Lances, Tarifa'
  where slug = 'los-lances';
update public.spots set lat = 36.067, lon = -5.693,
  note = 'The Levante spot, busy in summer: use the marked kite zone. Strong Levante gets gusty: know your limits.', maps = 'Playa de Valdevaqueros, Tarifa'
  where slug = 'valdevaqueros';

update public.spots set maps = 'Playa de El Palmar, Vejer de la Frontera' where slug = 'el-palmar' and maps is null;
update public.spots set maps = 'Parque Natural Los Alcornocales', note = coalesce(note, 'Natural park: ride the marked tracks only.') where slug = 'alcornocales' and maps is null;

-- Tatajuba: coming soon, a list to join
insert into public.cities (slug, name, country, status) values ('tatajuba', 'Tatajuba', 'BR', 'soon') on conflict (slug) do nothing;
update public.cities set tz = 'America/Fortaleza', region = coalesce(region, 'Ceará, Brazil') where slug = 'tatajuba';

-- trips: any plan can be one
alter table public.plans add column if not exists trip boolean not null default false;

create or replace function public.hi8_plans(p_city text default null, p_key uuid default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare em text;
begin
  if p_key is not null then select lower(email) into em from public.rider_keys where key = p_key; end if;
  return (select coalesce(json_agg(json_build_object(
      'slug', p.slug, 'city', p.city, 'kind', p.kind, 'title', p.title, 'place', p.place, 'blurb', p.blurb,
      'price_from', p.price_from, 'price_note', p.price_note, 'includes', p.includes, 'hours', p.hours,
      'spot', p.spot, 'maps', p.maps, 'url', p.url, 'badge', p.badge, 'trip', p.trip,
      'interested', (select count(*) from public.plan_leads l where l.plan = p.slug and l.created_at > now() - interval '60 days'),
      'mine', (select json_build_object('day', l.day, 'people', l.people) from public.plan_leads l where l.plan = p.slug and l.email = em))
    order by p.sort, p.slug), '[]'::json)
    from public.plans p where p.active and (p_city is null or p.city = p_city));
end $$;

-- hi8_waitlist: "tell me first" for a region that's coming soon. With a browser key, as that rider (no new key);
-- with an email, a plain sign-up on that region's list.
create or replace function public.hi8_waitlist(p_city text, p_key uuid default null, p_email text default null, p_source text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare c public.cities; em text; r json;
begin
  select * into c from public.cities where slug = lower(trim(coalesce(p_city, '')));
  if c.slug is null or c.status <> 'soon' then raise exception 'not_soon' using errcode = '22023', hint = 'That region isn''t taking a list.'; end if;
  perform public.hi8_limit('waitlist', coalesce(public.hi8_client(), 'none'), 20, interval '10 minutes');
  if p_key is not null then em := public.hi8_email(p_key); else em := lower(trim(coalesce(p_email, ''))); end if;
  if em is null or char_length(em) > 254 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_email' using errcode = '22023', hint = 'That email doesn''t look right.';
  end if;
  if exists (select 1 from public.signups s where s.city = c.slug and lower(s.email) = em) then
    return json_build_object('city', c.slug, 'name', c.name, 'already', true);
  end if;
  r := public.join_waitlist(p_city => c.slug, p_first_name => null, p_email => em,
                            p_source => left(coalesce(nullif(trim(p_source), ''), 'where-next'), 80), p_ref => null);
  return (r::jsonb || jsonb_build_object('name', c.name, 'already', false))::json;
end $$;

revoke execute on function public.hi8_waitlist(text, uuid, text, text) from public;
grant execute on function public.hi8_waitlist(text, uuid, text, text) to anon, authenticated;
grant execute on function public.hi8_plans(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
