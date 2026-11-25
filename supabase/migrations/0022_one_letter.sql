-- Hi8ctane 0022: outside a crew, riders show one letter, not two (2.28).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0021. Safe to run again.
--
-- Until now a crew's public page and the rider cards showed the first two letters of each rider's name. For a short
-- name (Bo, Jo, Al, Ed) that is the whole name, and names are for the crew only. Now it's the first letter.
--
-- The functions that do it (hi8_crew_card, the public crew page; hi8_crew_cards, the rider cards) are long, so instead
-- of copying them here this rewrites the one expression in whatever version your database has, and changes nothing else.

do $$
declare f record; def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('hi8_crew_card', 'hi8_crew_cards')
      and p.prosrc like '%left(public.hi8_name(m.email, c.city), 2)%'
  loop
    def := replace(pg_get_functiondef(f.oid), 'left(public.hi8_name(m.email, c.city), 2)', 'left(public.hi8_name(m.email, c.city), 1)');
    execute def;
  end loop;
end $$;

-- check: both say 1 (an empty result means 0003 or 0020 hasn't been run yet)
select p.proname, p.prosrc like '%c.city), 1)%' as one_letter
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('hi8_crew_card', 'hi8_crew_cards');

notify pgrst, 'reload schema';
