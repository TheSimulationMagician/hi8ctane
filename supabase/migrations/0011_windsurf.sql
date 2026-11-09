-- Hi8ctane 0011: windsurf, coming soon (2.12.1).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0010. Safe to run again.
-- Windsurf shows with the other "coming soon" sports, and riders can ask for an email when its crews open.

alter table public.crew_alerts drop constraint if exists crew_alerts_sport_check;
alter table public.crew_alerts add constraint crew_alerts_sport_check check (sport in ('kite', 'wing', 'surf', 'sup', 'mtb', 'mx', 'windsurf'));

create or replace function public.hi8_alert(p_key uuid, p_city text, p_sport text, p_on boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  if not exists (select 1 from public.cities where slug = p_city) then raise exception 'unknown_city' using errcode = '22023'; end if;
  if p_sport not in ('kite', 'wing', 'surf', 'sup', 'mtb', 'mx', 'windsurf') then raise exception 'bad_sport' using errcode = '22023'; end if;
  if coalesce(p_on, true) then
    insert into public.crew_alerts (email, city, sport) values (em, p_city, p_sport) on conflict do nothing;
  else
    delete from public.crew_alerts where email = em and city = p_city and sport = p_sport;
  end if;
  return json_build_object('alerts', public.hi8_alert_list(em));
end $$;

-- add windsurf to the "coming soon" list, keeping whatever else is there
update public.app_settings set value = value || '["windsurf"]'::jsonb
where key = 'soon_sports' and jsonb_typeof(value) = 'array' and not (value ? 'windsurf');

notify pgrst, 'reload schema';
