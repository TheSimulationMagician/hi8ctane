-- The 4 launch spots from spots.json (coordinates and wind arcs approximate; confirm with locals).
insert into spots (slug, name, lat, lon, sports, good_dir_from, good_dir_to, meeting_point, parking) values
  ('wijk-aan-zee', 'Wijk aan Zee', 52.496, 4.582, '{kite,wing,surf}', 200, 320, 'Kite beach, access 3 (beach pavilion)', 'Relweg lot, paid'),
  ('ijmuiden', 'IJmuiden', 52.46, 4.555, '{kite,wing,sup}', 200, 340, 'Kennemerstrand, south of the pier', 'Kennemerstrand lot'),
  ('zandvoort', 'Zandvoort', 52.373, 4.523, '{surf,kite}', 200, 330, 'North beach', 'Boulevard Barnaart'),
  ('schoorl', 'Schoorl dunes', 52.701, 4.687, '{mtb}', null, null, 'Schoorl MTB route start (Schoorlse duinen)', 'Duinvoetweg');
