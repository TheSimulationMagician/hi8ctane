-- Hi8ctane 0013: days out around Amsterdam (2.17).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0012. Safe to run again.
--
--   * Four plans for Amsterdam: an MTB day in the Schoorl dunes, two cable parks with obstacles
--     (Almere, close by; Burnside in Emst, a road trip) and an indoor snow day at SnowWorld Amsterdam.
--   * A new plan kind, 'snow'.
--   * Prices: only the MTB hire has one (about €28 a day, to confirm with the shop). The parks and SnowWorld
--     don't publish a price we could check, so theirs is empty and the card says "price on request".
--     Fill them in: Table Editor > plans > price_from, price_note.

alter table public.plans drop constraint if exists plans_kind_check;
alter table public.plans add constraint plans_kind_check check (kind in ('mx', 'mtb', 'kite', 'wing', 'surf', 'sup', 'wake', 'snow', 'other'));

insert into public.plans (slug, city, kind, title, place, blurb, price_from, price_note, includes, hours, spot, maps, url, badge, sort) values
  ('schoorl-mtb-day', 'amsterdam', 'mtb', 'MTB day in the dunes', 'Schoorlse Duinen · Schoorl',
   'The highest dunes in the country, pine forest and sandy singletrack, under an hour from Amsterdam. No bike? Hire one in the village. Go with others the same day and the drive costs a fraction.',
   28, 'Bike hire from about €28 a day at the rental shops in Schoorl: check the price and book ahead. With your own bike you only split the fuel.',
   '{"Dune singletrack","Bike hire in the village","Under an hour away"}', 'All year, in daylight. Best when the sand is damp.',
   'schoorl', 'Schoorlse Duinen, Schoorl', null, 'DUNES', 1),
  ('almere-cable', 'amsterdam', 'wake', 'Cable day with obstacles', 'Cablepark Almere · Weerwater',
   'A main cable of almost 1,000 metres on the Weerwater with obstacles to practise tricks, and a 200-metre beginner track next to it. Board and wetsuit hire at the park. Made for the days the wind stays home.',
   null, 'Ask the park for prices. Board and wetsuit hire there. Reservations required.',
   '{"Almost 1,000 m cable","Obstacles for tricks","200 m beginner track"}', 'Closed in the winter months: check the park for dates.',
   null, 'Cablepark Almere, Bergsmapad 1, Almere', 'https://cableparkviewalmere.nl/', 'NO-WIND DAY', 2),
  ('burnside-cable', 'amsterdam', 'wake', 'Wake day at Burnside', 'Burnside Cablepark · Emst',
   'A cable on the Kievitsveld lake on the Veluwe, for first-timers and riders who want to push it. It''s a drive, so it''s one to share: fill the car and make a day of it.',
   null, 'Ask the park for prices and hire.',
   '{"Wakeboard + waterski","Beginners to advanced","Lake on the Veluwe"}', 'April to October.',
   null, 'Burnside Cablepark, Viskweekweg 5, Emst', null, 'ROAD TRIP', 3),
  ('snowworld-amsterdam', 'amsterdam', 'snow', 'Indoor snow day', 'SnowWorld Amsterdam · Velsen-Zuid',
   'Real snow about 20 minutes from the centre: a 170-metre slope, a 70-metre beginner slope and a funpark with rails and a tube. Ski and board hire can be added when you book.',
   null, 'Passes by the hour or the day: see SnowWorld''s current rates. Hire is extra.',
   '{"170 m slope","Funpark with rails","Open every day"}', 'Winter: Mon to Fri 9:00-22:00 · Sat 8:00-22:00 · Sun 8:00-21:00',
   null, 'SnowWorld Amsterdam, Heuvelweg 6-8, Velsen-Zuid', 'https://snowworld.com/amsterdam/en/ski-slope', 'ALL WINTER', 4)
on conflict (slug) do update set city = excluded.city, kind = excluded.kind, title = excluded.title, place = excluded.place, blurb = excluded.blurb,
  price_from = excluded.price_from, price_note = excluded.price_note, includes = excluded.includes, hours = excluded.hours, spot = excluded.spot,
  maps = excluded.maps, url = excluded.url, badge = excluded.badge, sort = excluded.sort, updated_at = now();
