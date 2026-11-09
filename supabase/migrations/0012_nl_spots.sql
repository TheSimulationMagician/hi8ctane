-- Hi8ctane 0012: three more kite spots near Amsterdam (2.12.2).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0011. Safe to run again.
--
--   * Noordwijk: the kite zone north of the lighthouse (register at Beach Break).
--   * Muiderberg: the official kite launch on the IJmeer, 20 minutes from the centre.
--   * Schellinkhout: flat, standing-depth water on the Markermeer.

insert into public.spots (slug, city, name, lat, lon, sports, face, good_from, good_to, lake, note, sort, maps) values
  ('noordwijk',     'amsterdam', 'Noordwijk',     52.252, 4.432, '{kite,surf}', 290, 200, 340, false,
   'Kite zone north of the lighthouse: register at Beach Break before you launch. No groynes.', 8, 'Beach Break Noordwijk'),
  ('muiderberg',    'amsterdam', 'Muiderberg',    52.333, 5.118, '{kite,wing}', 10, 270, 100, true,
   'Official kite launch on the IJmeer, with about 200 m of standing-depth water. The Gooimeer next door is closed to kiting. Parking on the dyke fills up fast.', 9, 'Strand Muiderberg'),
  ('schellinkhout', 'amsterdam', 'Schellinkhout', 52.632, 5.119, '{kite,wing}', 180, 80, 290, true,
   'Flat, standing-depth water for about 400 m, choppy further out. Rig on the dyke by the church. Busy on good days: park in the marked spots.', 10, 'Schellinkhout')
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
