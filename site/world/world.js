/* Hi8ctane · Open World
 * A real 3D map (MapLibre GL, vendored in ../vendor/maplibre) you fly around: tap a spot, a region, a chip or ‹ ›
 * and the camera climbs, crosses and lands on it, then slowly circles. Two looks: DAYLIGHT and TOPO.
 * Map data: OpenFreeMap vector tiles (© OpenMapTiles, © OpenStreetMap contributors). Terrain: AWS Terrain Tiles (Mapzen).
 * Wind and rain: Open-Meteo (the same source and key as the rest of the site). Nothing is made up: when the forecast
 * can't be reached the card says so. ?offline=1 draws a light coastline only (for tests without the tile servers).
 */
(function () {
  'use strict';
  var CFG = window.HI8_CONFIG || {};
  var MKEY = String(CFG.meteoKey || '').trim();
  var METEO = String(CFG.forecastApi || (MKEY ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com')).replace(/\/+$/, '');
  var KEYQ = MKEY ? '&apikey=' + encodeURIComponent(MKEY) : '';
  var Q = new URLSearchParams(location.search);
  var OFFLINE = Q.get('offline') === '1';
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // the spots: the same places and coordinates as the app (hi8.js). Rentals are placeholders until a partner signs.
  var SPOTS = [
    { id: 'muiderberg', city: 'amsterdam', reg: 'NETHERLANDS', name: 'Muiderberg', kind: 'kite', lat: 52.333, lon: 5.118, bearing: 15, zoom: 12.4 },
    { id: 'schellinkhout', city: 'amsterdam', reg: 'NETHERLANDS', name: 'Schellinkhout', kind: 'kite', lat: 52.632, lon: 5.119, bearing: 160, zoom: 12.4 },
    { id: 'ijmuiden', city: 'amsterdam', reg: 'NETHERLANDS', name: 'IJmuiden', kind: 'kite', lat: 52.460, lon: 4.555, bearing: 80, zoom: 12.6 },
    { id: 'wijk-aan-zee', city: 'amsterdam', reg: 'NETHERLANDS', name: 'Wijk aan Zee', kind: 'kite', lat: 52.496, lon: 4.582, bearing: 70, zoom: 12.6 },
    { id: 'zandvoort', city: 'amsterdam', reg: 'NETHERLANDS', name: 'Zandvoort', kind: 'kite', lat: 52.373, lon: 4.523, bearing: 75, zoom: 12.6 },
    { id: 'noordwijk', city: 'amsterdam', reg: 'NETHERLANDS', name: 'Noordwijk', kind: 'kite', lat: 52.252, lon: 4.432, bearing: 65, zoom: 12.6 },
    { id: 'schoorl', city: 'amsterdam', reg: 'NETHERLANDS', name: 'Schoorl dunes', kind: 'mtb', lat: 52.701, lon: 4.687, bearing: 100, zoom: 13.2, pitch: 70 },
    { id: 'amsterdamse-bos', city: 'amsterdam', reg: 'NETHERLANDS', name: 'Amsterdamse Bos', kind: 'mtb', lat: 52.330, lon: 4.840, bearing: 20, zoom: 13.2 },
    { id: 'brouwersdam', city: '', reg: 'NETHERLANDS', name: 'Brouwersdam', kind: 'kite', lat: 51.763, lon: 3.853, bearing: 40, zoom: 12.4, trip: true },
    { id: 'castelldefels', city: 'barcelona', reg: 'BARCELONA', name: 'Castelldefels', kind: 'kite', lat: 41.268, lon: 1.985, bearing: 340, zoom: 12.6 },
    { id: 'bcn-rental', city: 'barcelona', reg: 'BARCELONA', name: 'Castelldefels rental', kind: 'rental', lat: 41.272, lon: 1.958, bearing: 330, zoom: 14 },
    { id: 'sant-pere-pescador', city: 'barcelona', reg: 'BARCELONA', name: 'Sant Pere Pescador', kind: 'kite', lat: 42.190, lon: 3.110, bearing: 290, zoom: 12.4 },
    { id: 'riumar', city: 'barcelona', reg: 'BARCELONA', name: 'Riumar', kind: 'kite', lat: 40.730, lon: 0.866, bearing: 250, zoom: 12.4 },
    { id: 'collserola', city: 'barcelona', reg: 'BARCELONA', name: 'Collserola', kind: 'mtb', lat: 41.418, lon: 2.115, bearing: 320, zoom: 13, pitch: 68 },
    { id: 'garraf-park', city: 'barcelona', reg: 'BARCELONA', name: 'Garraf park', kind: 'mtb', lat: 41.290, lon: 1.870, bearing: 20, zoom: 12.8, pitch: 68 },
    { id: 'valdevaqueros', city: 'tarifa', reg: 'TARIFA', name: 'Valdevaqueros', kind: 'kite', lat: 36.067, lon: -5.693, bearing: 25, zoom: 13 },
    { id: 'tarifa-rental-v', city: 'tarifa', reg: 'TARIFA', name: 'Valdevaqueros rental', kind: 'rental', lat: 36.072, lon: -5.680, bearing: 35, zoom: 14.2 },
    { id: 'los-lances', city: 'tarifa', reg: 'TARIFA', name: 'Los Lances', kind: 'kite', lat: 36.031, lon: -5.623, bearing: 10, zoom: 13 },
    { id: 'tarifa-rental-l', city: 'tarifa', reg: 'TARIFA', name: 'Los Lances rental', kind: 'rental', lat: 36.024, lon: -5.612, bearing: 15, zoom: 14.2 },
    { id: 'alcornocales', city: 'tarifa', reg: 'TARIFA', name: 'Alcornocales', kind: 'mtb', lat: 36.400, lon: -5.600, bearing: 200, zoom: 12.6, pitch: 70 },
    // the world's top kite spots: places you drive to (or share a car to) from the nearest town or airport.
    // Coordinates are the beach or lagoon, to a few hundred metres: check the exact launch before a crew goes.
    { id: 'fuerteventura', city: '', reg: 'EUROPE', name: 'Sotavento, Fuerteventura', kind: 'kite', lat: 28.135, lon: -14.225, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'leucate', city: '', reg: 'EUROPE', name: 'La Franqui, Leucate', kind: 'kite', lat: 42.935, lon: 3.035, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'guincho', city: '', reg: 'EUROPE', name: 'Guincho', kind: 'kite', lat: 38.73, lon: -9.473, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'obidos', city: '', reg: 'EUROPE', name: 'Lagoa de Óbidos', kind: 'kite', lat: 39.405, lon: -9.215, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'stagnone', city: '', reg: 'EUROPE', name: 'Lo Stagnone, Sicily', kind: 'kite', lat: 37.865, lon: 12.465, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'porto-pollo', city: '', reg: 'EUROPE', name: 'Porto Pollo, Sardinia', kind: 'kite', lat: 41.19, lon: 9.325, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'prasonisi', city: '', reg: 'EUROPE', name: 'Prasonisi, Rhodes', kind: 'kite', lat: 35.88, lon: 27.765, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'mikri-vigla', city: '', reg: 'EUROPE', name: 'Mikri Vigla, Naxos', kind: 'kite', lat: 37.025, lon: 25.375, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'alacati', city: '', reg: 'EUROPE', name: 'Alaçatı', kind: 'kite', lat: 38.255, lon: 26.37, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'podersdorf', city: '', reg: 'EUROPE', name: 'Podersdorf, Neusiedl', kind: 'kite', lat: 47.855, lon: 16.83, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'hvide-sande', city: '', reg: 'EUROPE', name: 'Hvide Sande', kind: 'kite', lat: 56.0, lon: 8.13, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'sylt', city: '', reg: 'EUROPE', name: 'Westerland, Sylt', kind: 'kite', lat: 54.905, lon: 8.3, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'dakhla', city: '', reg: 'AFRICA', name: 'Dakhla lagoon', kind: 'kite', lat: 23.8, lon: -15.93, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'essaouira', city: '', reg: 'AFRICA', name: 'Essaouira', kind: 'kite', lat: 31.5, lon: -9.77, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'el-gouna', city: '', reg: 'AFRICA', name: 'El Gouna', kind: 'kite', lat: 27.39, lon: 33.68, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'le-morne', city: '', reg: 'AFRICA', name: 'Le Morne, Mauritius', kind: 'kite', lat: -20.455, lon: 57.315, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'paje', city: '', reg: 'AFRICA', name: 'Paje, Zanzibar', kind: 'kite', lat: -6.27, lon: 39.54, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'langebaan', city: '', reg: 'AFRICA', name: 'Langebaan lagoon', kind: 'kite', lat: -33.1, lon: 18.03, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'bloubergstrand', city: '', reg: 'AFRICA', name: 'Bloubergstrand', kind: 'kite', lat: -33.8, lon: 18.46, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'cumbuco', city: '', reg: 'AMERICAS', name: 'Cumbuco', kind: 'kite', lat: -3.627, lon: -38.735, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'jericoacoara', city: '', reg: 'AMERICAS', name: 'Jericoacoara', kind: 'kite', lat: -2.795, lon: -40.513, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'cabarete', city: '', reg: 'AMERICAS', name: 'Cabarete', kind: 'kite', lat: 19.763, lon: -70.42, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'la-ventana', city: '', reg: 'AMERICAS', name: 'La Ventana', kind: 'kite', lat: 24.05, lon: -109.99, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'hood-river', city: '', reg: 'AMERICAS', name: 'Hood River', kind: 'kite', lat: 45.712, lon: -121.513, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'hatteras', city: '', reg: 'AMERICAS', name: 'Cape Hatteras', kind: 'kite', lat: 35.3, lon: -75.52, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'kanaha', city: '', reg: 'AMERICAS', name: 'Kanaha, Maui', kind: 'kite', lat: 20.9, lon: -156.43, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'paracas', city: '', reg: 'AMERICAS', name: 'Paracas', kind: 'kite', lat: -13.84, lon: -76.25, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'mui-ne', city: '', reg: 'ASIA · OCEANIA', name: 'Mui Ne', kind: 'kite', lat: 10.95, lon: 108.29, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'boracay', city: '', reg: 'ASIA · OCEANIA', name: 'Bulabog, Boracay', kind: 'kite', lat: 11.96, lon: 121.94, bearing: 0, zoom: 12, pitch: 58, trip: true },
    { id: 'lancelin', city: '', reg: 'ASIA · OCEANIA', name: 'Lancelin', kind: 'kite', lat: -31.02, lon: 115.33, bearing: 0, zoom: 12, pitch: 58, trip: true }
  ];
  var REGS = []; SPOTS.forEach(function (s) { if (REGS.indexOf(s.reg) < 0) REGS.push(s.reg); });
  var BOXES = { NETHERLANDS: [3.6, 51.6, 5.7, 53.0], BARCELONA: [0.4, 40.4, 3.5, 42.6], TARIFA: [-6.4, 35.9, -5.2, 36.6] };

  // ---------- the looks ----------
  var OMT = 'https://tiles.openfreemap.org/planet';
  var DEM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
  var DEM_ATTR = 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen, AWS Terrain Tiles</a>';
  function grid() {
    var f = [];
    Object.keys(BOXES).forEach(function (k) {
      var b = BOXES[k], s = 0.05, x, y;
      for (x = Math.ceil(b[0] / s) * s; x <= b[2]; x += s) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[x, b[1]], [x, b[3]]] } });
      for (y = Math.ceil(b[1] / s) * s; y <= b[3]; y += s) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[b[0], y], [b[2], y]] } });
    });
    return { type: 'FeatureCollection', features: f };
  }
  function cls(layer, list) { return ['match', ['get', 'class'], list, true, false]; }
  var Z = function (a) { return ['interpolate', ['linear'], ['zoom']].concat(a); };
  function style(look) {
    var day = look === 'day';
    var C = day ? {
      land: '#C9D49C', water: '#2A87B5', shallow: '#86DCE2', foam: 'rgba(255,255,255,.75)', wood: '#6E9A4E', grass: '#A9C57B', farm: '#D5D8A2', sand: '#F3E3B2', wet: '#A5CDB0', rock: '#BDB6A6',
      town: '#E7DDC7', park: '#9CC47E', road: '#FFF8E6', minor: 'rgba(255,255,255,.55)', bldg: '#F1EADB', border: 'rgba(255,255,255,.85)', label: '#1D1D1D', halo: 'rgba(243,239,227,.92)',
      shadow: '#47402A', hi: '#FFFFFF', accent: '#5E5236', hsx: 0.55
    } : {
      land: '#123A63', water: '#0A1F3A', shallow: '#7FB8E8', foam: '#E6F4FF', wood: '#17426F', grass: '#14406C', farm: '#133C66', sand: '#1C4A78', wet: '#123E6A', rock: '#1E4C7C',
      town: '#16426E', park: '#164270', road: 'rgba(255,225,77,.55)', minor: 'rgba(156,203,242,.28)', bldg: '#2A5D90', border: '#FFE14D', label: '#E6F4FF', halo: '#0A1F3A',
      shadow: '#04101F', hi: '#9CCBF2', accent: '#2A5D90', hsx: 0.9
    };
    var src = {
      lite: { type: 'geojson', data: 'land-lite.json' },
      grid: { type: 'geojson', data: grid() }
    };
    var L = [];
    if (OFFLINE) {
      L.push({ id: 'bg', type: 'background', paint: { 'background-color': C.water } });
      L.push({ id: 'lite', type: 'fill', source: 'lite', paint: { 'fill-color': C.land } });
      L.push({ id: 'lite-edge', type: 'line', source: 'lite', paint: { 'line-color': C.foam, 'line-width': 1.2 } });
    } else {
      src.omt = { type: 'vector', url: OMT };
      src.dem = { type: 'raster-dem', tiles: DEM_TILES, encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: DEM_ATTR };
      src.hs = { type: 'raster-dem', tiles: DEM_TILES, encoding: 'terrarium', tileSize: 256, maxzoom: 14 };
      var V = function (o) { o.source = 'omt'; return o; };
      L.push({ id: 'bg', type: 'background', paint: { 'background-color': C.land } });
      L.push(V({ id: 'lc-farm', type: 'fill', 'source-layer': 'landcover', filter: cls(0, ['farmland']), paint: { 'fill-color': C.farm, 'fill-opacity': 0.6 } }));
      L.push(V({ id: 'lc-grass', type: 'fill', 'source-layer': 'landcover', filter: cls(0, ['grass']), paint: { 'fill-color': C.grass, 'fill-opacity': 0.7 } }));
      L.push(V({ id: 'lc-wood', type: 'fill', 'source-layer': 'landcover', filter: cls(0, ['wood', 'forest']), paint: { 'fill-color': C.wood, 'fill-opacity': 0.75 } }));
      L.push(V({ id: 'lc-wet', type: 'fill', 'source-layer': 'landcover', filter: cls(0, ['wetland']), paint: { 'fill-color': C.wet, 'fill-opacity': 0.7 } }));
      L.push(V({ id: 'lc-rock', type: 'fill', 'source-layer': 'landcover', filter: cls(0, ['rock', 'ice']), paint: { 'fill-color': C.rock, 'fill-opacity': 0.6 } }));
      L.push(V({ id: 'lc-sand', type: 'fill', 'source-layer': 'landcover', filter: cls(0, ['sand', 'beach']), paint: { 'fill-color': C.sand, 'fill-opacity': 0.95 } }));
      L.push(V({ id: 'lu-town', type: 'fill', 'source-layer': 'landuse', filter: cls(0, ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail']), paint: { 'fill-color': C.town, 'fill-opacity': Z([8, 0.25, 13, 0.7]) } }));
      L.push(V({ id: 'park', type: 'fill', 'source-layer': 'park', paint: { 'fill-color': C.park, 'fill-opacity': 0.45 } }));
      L.push({ id: 'hs', type: 'hillshade', source: 'hs', paint: { 'hillshade-exaggeration': C.hsx, 'hillshade-shadow-color': C.shadow, 'hillshade-highlight-color': C.hi, 'hillshade-accent-color': C.accent, 'hillshade-illumination-direction': 315 } });
      L.push(V({ id: 'water', type: 'fill', 'source-layer': 'water', paint: { 'fill-color': C.water } }));
      if (day) {
        // the shallows: a soft turquoise band along every shore, inside the water
        L.push(V({ id: 'shallow', type: 'line', 'source-layer': 'water', paint: { 'line-color': C.shallow, 'line-width': Z([5, 2, 10, 10, 14, 30]), 'line-blur': Z([5, 2, 10, 8, 14, 24]), 'line-offset': Z([5, 1, 10, 5, 14, 15]), 'line-opacity': 0.75 } }));
      } else {
        // contour rings out from every shore, like a depth chart
        [[4, 0.55], [9, 0.38], [16, 0.24], [25, 0.13]].forEach(function (r, i) {
          L.push(V({ id: 'ring' + i, type: 'line', 'source-layer': 'water', paint: { 'line-color': C.shallow, 'line-width': 1, 'line-offset': Z([5, r[0] * 0.35, 10, r[0], 14, r[0] * 1.6]), 'line-opacity': r[1] } }));
        });
      }
      L.push(V({ id: 'foam', type: 'line', 'source-layer': 'water', paint: { 'line-color': C.foam, 'line-width': Z([5, 0.4, 12, day ? 1.2 : 1.4, 16, 2]) } }));
      L.push(V({ id: 'river', type: 'line', 'source-layer': 'waterway', paint: { 'line-color': day ? C.water : C.shallow, 'line-width': Z([8, 0.4, 14, 2]), 'line-opacity': day ? 1 : 0.6 } }));
      L.push(V({ id: 'road-minor', type: 'line', 'source-layer': 'transportation', minzoom: 12, filter: cls(0, ['minor', 'service', 'track', 'path']), paint: { 'line-color': C.minor, 'line-width': Z([12, 0.4, 16, 2]) } }));
      L.push(V({ id: 'road', type: 'line', 'source-layer': 'transportation', filter: cls(0, ['motorway', 'trunk', 'primary', 'secondary']), paint: { 'line-color': C.road, 'line-width': Z([6, 0.4, 10, 1.2, 15, 4]) } }));
      L.push(V({ id: 'border', type: 'line', 'source-layer': 'boundary', filter: ['==', ['get', 'admin_level'], 2], paint: { 'line-color': C.border, 'line-width': 1.4, 'line-dasharray': [3, 2] } }));
      L.push(V({ id: 'bldg', type: 'fill-extrusion', 'source-layer': 'building', minzoom: 13, paint: { 'fill-extrusion-color': C.bldg, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': day ? 0.9 : 0.75 } }));
    }
    if (!day) L.push({ id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#E6F4FF', 'line-width': 0.6, 'line-opacity': Z([6, 0.04, 11, 0.12]) } });
    if (!OFFLINE) {
      L.push(V2({ id: 'places', type: 'symbol', 'source-layer': 'place', filter: cls(0, ['city', 'town', 'village']),
        layout: { 'text-field': ['upcase', ['coalesce', ['get', 'name:latin'], ['get', 'name']]], 'text-font': ['Noto Sans Bold'], 'text-size': ['match', ['get', 'class'], 'city', 14, 'town', 12, 10.5], 'text-letter-spacing': 0.12, 'text-max-width': 8 },
        paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.6 } }));
    }
    function V2(o) { o.source = 'omt'; return o; }
    var s = {
      version: 8, sources: src, layers: L, projection: { type: 'globe' },
      sky: day ? { 'sky-color': '#5BB8E6', 'horizon-color': '#F4F1E4', 'fog-color': '#EDEBDF', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35, 'atmosphere-blend': Z([0, 1, 10, 1, 12, 0]) }
        : { 'sky-color': '#061226', 'horizon-color': '#2A5D90', 'fog-color': '#0E2A4A', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.25, 'atmosphere-blend': Z([0, 1, 10, 1, 12, 0]) }
    };
    if (!OFFLINE) { s.glyphs = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'; s.terrain = { source: 'dem', exaggeration: 1.6 }; }
    return s;
  }

  // ---------- forecast (Open-Meteo) ----------
  var WX = {}, WXERR = {};
  var DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  function compass(d) { return DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
  function ktTone(k) { return k >= 22 ? 't-epic' : k >= 16 ? 't-good' : k >= 12 ? 't-ok' : 't-no'; }
  function rainTone(mm) { return mm < 0.5 ? 't-good' : mm < 3 ? 't-ok' : 't-no'; }
  function dayOf(date) { return DOW[new Date(date + 'T12:00:00Z').getUTCDay()]; }
  function load(s) {
    if (s.kind === 'rental' || WX[s.id] || WXERR[s.id] === 'busy') return;
    var key = 'hi8w2:' + s.id;
    try { var c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 30 * 60e3) { WX[s.id] = c.v; return; } } catch (e) { /* storage blocked */ }
    WXERR[s.id] = 'busy';
    var url = METEO + '/v1/forecast?latitude=' + s.lat + '&longitude=' + s.lon + '&timezone=auto&forecast_days=7' +
      (s.kind === 'mtb' ? '&hourly=precipitation,temperature_2m' : '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn') + KEYQ;
    fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      var v = s.kind === 'mtb' ? mtbDays(j) : kiteDays(j);
      WX[s.id] = v; delete WXERR[s.id];
      try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: v })); } catch (e) { /* fine */ }
      paint();
    }).catch(function () { WXERR[s.id] = 'down'; paint(); });
  }
  function kiteDays(j) {
    var H = j.hourly || {}, t = H.time || [], w = H.wind_speed_10m || [], g = H.wind_gusts_10m || [], d = H.wind_direction_10m || [];
    var off = (j.utc_offset_seconds || 0) * 1000, nowIso = new Date(Date.now() + off).toISOString().slice(0, 13);
    var days = [], by = {}, now = null;
    t.forEach(function (ts, i) {
      if (ts.slice(0, 13) === nowIso && w[i] != null) now = { kt: Math.round(w[i]), dir: compass(d[i]) };
      var date = ts.slice(0, 10), h = +ts.slice(11, 13);
      if (!by[date]) { by[date] = { date: date, dow: dayOf(date), kt: null }; days.push(by[date]); }
      if (h < 9 || h > 17 || w[i] == null || w[i + 1] == null || w[i + 2] == null) return;
      var m = (w[i] + w[i + 1] + w[i + 2]) / 3;
      if (by[date].kt == null || m > by[date].kt) {
        by[date].kt = m; by[date].from = h; by[date].dir = compass(d[i + 1]);
        by[date].gust = Math.round(Math.max(g[i] || 0, g[i + 1] || 0, g[i + 2] || 0));
      }
    });
    days.forEach(function (x) { if (x.kt != null) x.kt = Math.round(x.kt); });
    return { kind: 'kite', days: days.slice(0, 7), now: now, at: Date.now() };
  }
  function mtbDays(j) {
    var H = j.hourly || {}, t = H.time || [], pr = H.precipitation || [], tc = H.temperature_2m || [], days = [], by = {};
    t.forEach(function (ts, i) {
      var date = ts.slice(0, 10), h = +ts.slice(11, 13);
      if (!by[date]) { by[date] = { date: date, dow: dayOf(date), mm: 0, tmax: null }; days.push(by[date]); }
      if (pr[i] != null) by[date].mm += pr[i];
      if (h >= 8 && h <= 18 && tc[i] != null && (by[date].tmax == null || tc[i] > by[date].tmax)) by[date].tmax = tc[i];
    });
    return { kind: 'mtb', at: Date.now(), days: days.slice(0, 7) };
  }
  function best(v) {
    if (!v) return null;
    var b = null;
    v.days.forEach(function (x, i) {
      if (v.kind === 'kite') { if (x.kt != null && (!b || x.kt > b.kt)) b = Object.assign({ i: i }, x); }
      else if (x.mm != null && (!b || x.mm < b.mm || (x.mm === b.mm && x.tmax > b.tmax))) b = Object.assign({ i: i }, x);
    });
    return b;
  }

  // ---------- state ----------
  var S = { sel: -1, day: null, look: Q.get('look') === 'topo' ? 'topo' : 'day', adding: false };
  try { if (!Q.get('look') && localStorage.getItem('hi8.world.look') === 'topo') S.look = 'topo'; } catch (e) { /* fine */ }
  var mine = [];
  try { mine = JSON.parse(localStorage.getItem('hi8.world.mine') || '[]'); } catch (e) { mine = []; }
  mine.forEach(function (m) { SPOTS.push(m); });

  // ---------- the map ----------
  var map, pins = [];
  document.body.className = S.look;
  try {
    map = new maplibregl.Map({
      container: 'map', style: style(S.look), center: [-20, 30], zoom: window.innerWidth < 700 ? 0.9 : 1.6, pitch: 0, bearing: 0,
      maxPitch: 78, attributionControl: false, dragRotate: true, pitchWithRotate: true, fadeDuration: 150
    });
  } catch (e) {
    document.getElementById('card').innerHTML = '<p class="line">This browser can\'t draw the 3D map (WebGL is off). <a href="../" style="color:inherit">Back to Hi8ctane</a></p>';
    return;
  }
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  window.HI8W = { map: map, S: S, SPOTS: SPOTS, WX: WX };

  function pinHtml(s, on) {
    var v = WX[s.id], b = best(v), tone, big;
    if (s.kind === 'rental') { tone = 't-rent'; big = 'R'; }
    else if (s.kind === 'mtb') { tone = 't-mtb'; big = 'MTB'; }
    else if (b) { tone = ktTone(b.kt); big = b.kt; }
    else { tone = 't-no'; big = '··'; }
    return '<span class="nm">' + esc(s.name.toUpperCase()) + '</span><span class="bx">' + big + '</span><span class="st"></span><span class="ft"></span>' + (on ? '' : '');
  }
  function makePins() {
    pins.forEach(function (p) { p.m.remove(); });
    pins = SPOTS.map(function (s, i) {
      var el = document.createElement('button');
      el.type = 'button'; el.className = 'pin'; el.setAttribute('aria-label', s.name);
      el.addEventListener('click', function (e) { e.stopPropagation(); pick(i); });
      var m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([s.lon, s.lat]).addTo(map);
      return { el: el, m: m };
    });
  }
  function paintPins() {
    pins.forEach(function (p, i) {
      var s = SPOTS[i], on = i === S.sel, b = best(WX[s.id]);
      var tone = s.kind === 'rental' ? 't-rent' : s.kind === 'mtb' ? 't-mtb' : b ? ktTone(b.kt) : 't-no';
      // keep MapLibre's own marker classes: only swap ours
      ['t-epic', 't-good', 't-ok', 't-no', 't-mtb', 't-rent', 'on'].forEach(function (c) { p.el.classList.remove(c); });
      p.el.classList.add('pin', tone); if (on) p.el.classList.add('on');
      p.el.innerHTML = pinHtml(s, on);
      p.el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function zoomClass() {
    var z = map.getZoom(), c = map.getContainer();
    c.classList.toggle('far', z < 10.5); c.classList.toggle('vfar', z < 8); c.classList.toggle('space', z < 4);
  }
  map.on('zoom', zoomClass);
  // pins far behind the horizon would float at the top of the sky: hide what's too far from where you are
  var lastCull = 0;
  function cull() {
    var now = performance.now(); if (now - lastCull < 120) return; lastCull = now;
    var c = map.getCenter(), z = map.getZoom(), lim = z >= 9 ? 140 : z >= 5.5 ? 900 : 8200; // past ~75° round the globe a pin is on the far side
    pins.forEach(function (p, i) { var s = SPOTS[i]; p.el.style.display = km([c.lng, c.lat], [s.lon, s.lat]) > lim ? 'none' : ''; });
  }
  map.on('move', cull); map.on('moveend', function () { lastCull = 0; cull(); });

  // ---------- flying ----------
  var orbit = 0, lastT = 0, userBusy = false;
  function pad() {
    var wide = window.innerWidth >= 900, card = document.getElementById('card').offsetHeight || 210;
    return wide ? { left: 460, right: 40, top: 80, bottom: 60 } : { left: 0, right: 0, top: 120, bottom: card + 110 };
  }
  function km(a, b) {
    var R = 6371, dLat = (b[1] - a[1]) * Math.PI / 180, dLon = (b[0] - a[0]) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fly(i, first) {
    var s = SPOTS[i], c = map.getCenter(), d = km([c.lng, c.lat], [s.lon, s.lat]);
    stopOrbit();
    var far = d > 600 || map.getZoom() < 4;
    var land = function () {
      map.flyTo({
        center: [s.lon, s.lat], zoom: s.zoom || 12.6, pitch: s.pitch || 62, bearing: s.bearing || 0, padding: pad(),
        duration: REDUCED ? 0 : far ? 3600 : 2600, curve: 1.3, essential: true
      }, { hi8: true });
    };
    if (!far || REDUCED) return land();
    // up to space, spin the globe round to the spot, then dive in
    var hop = ++hops;
    map.easeTo({ center: [s.lon, s.lat], zoom: window.innerWidth < 700 ? 1.6 : 2.3, pitch: 0, bearing: 0, padding: pad(), duration: first ? 2400 : Math.min(4200, 1600 + d * 0.35), easing: function (t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }, essential: true });
    map.once('moveend', function () { if (hop === hops) land(); });
  }
  var hops = 0;
  function globe() {
    hops++; stopOrbit(); S.sel = -1; S.globe = true; paintGlobe();
    map.easeTo({ zoom: window.innerWidth < 700 ? 1.1 : 1.8, pitch: 0, bearing: 0, padding: { left: 0, right: 0, top: 0, bottom: 120 }, duration: REDUCED ? 0 : 2600 });
    map.once('moveend', function () { if (S.globe) spin(); });
  }
  var spinning = 0;
  function spin() {
    if (REDUCED || spinning) return;
    var last = performance.now();
    var step = function (t) {
      if (!S.globe) { spinning = 0; return; }
      var dt = Math.min(64, t - last); last = t;
      var c = map.getCenter(); map.setCenter([c.lng + dt * 0.006, c.lat]);
      spinning = requestAnimationFrame(step);
    };
    spinning = requestAnimationFrame(step);
  }
  map.on('moveend', function (e) {
    if (e.hi8 && !userBusy) startOrbit();
    if (e.hi8) setTimeout(function () { $('#title').classList.add('gone'); }, 1800);
  });
  function startOrbit() {
    if (REDUCED || orbit) return;
    lastT = performance.now();
    var step = function (t) {
      var dt = Math.min(64, t - lastT); lastT = t;
      map.setBearing(map.getBearing() + dt * 0.0016);
      orbit = requestAnimationFrame(step);
    };
    orbit = requestAnimationFrame(step);
  }
  function stopOrbit() { if (orbit) cancelAnimationFrame(orbit); orbit = 0; }
  ['mousedown', 'touchstart', 'wheel'].forEach(function (ev) {
    map.getCanvas().addEventListener(ev, function () { userBusy = true; stopOrbit(); if (spinning) { cancelAnimationFrame(spinning); spinning = 0; } }, { passive: true });
  });

  // ---------- picking ----------
  function pick(i) {
    var n = SPOTS.length; i = ((i % n) + n) % n;
    var same = i === S.sel;
    S.sel = i; S.day = null; userBusy = false; S.globe = false; if (spinning) { cancelAnimationFrame(spinning); spinning = 0; }
    var s = SPOTS[i];
    SPOTS.forEach(function (o) { if (o.reg === s.reg) load(o); });
    paint();
    if (!same || !orbit) fly(i);
    try { history.replaceState(null, '', '?spot=' + s.id + (S.look === 'topo' ? '&look=topo' : '')); } catch (e) { /* fine */ }
  }
  function paintGlobe() {
    $('#regs').innerHTML = '<button type="button" data-act="globe" aria-pressed="true">GLOBE</button>' + REGS.map(function (r) {
      return '<button type="button" data-reg="' + r + '" aria-pressed="false">' + r + '</button>';
    }).join('');
    $('#chips').innerHTML = '';
    var kite = SPOTS.filter(function (o) { return o.kind === 'kite'; }).length;
    $('#card').innerHTML = '<div class="row"><span class="tag kite">THE WORLD</span><span class="where">' + SPOTS.length + ' SPOTS · ' + REGS.length + ' REGIONS</span></div>' +
      '<div class="row"><span class="nm">Where to next?</span><span class="big">' + kite + '<small>KITE</small></span></div>' +
      '<div class="line">Tap a pin or a region and the globe spins you there. Road trips are the spots you drive to: share the car, split the fuel.</div>';
    document.documentElement.style.setProperty('--cardH', $('#card').offsetHeight + 'px');
    paintPins();
  }
  function paint() {
    if (S.globe) return paintGlobe();
    if (S.sel < 0) return;
    var s = SPOTS[S.sel];
    $('#regs').innerHTML = '<button type="button" data-act="globe" aria-pressed="false">GLOBE</button>' + REGS.map(function (r) {
      return '<button type="button" data-reg="' + r + '" aria-pressed="' + (r === s.reg) + '">' + r + '</button>';
    }).join('');
    $('#chips').innerHTML = SPOTS.map(function (o, i) {
      if (o.reg !== s.reg) return '';
      var b = best(WX[o.id]), tag;
      if (o.kind === 'rental') tag = '<i class="t-rent">R</i>';
      else if (o.kind === 'mtb') tag = '<i class="t-mtb">MTB</i>';
      else tag = b ? '<i class="' + ktTone(b.kt) + '">' + b.kt + '</i>' : '';
      return '<button type="button" data-i="' + i + '" aria-pressed="' + (i === S.sel) + '">' + esc(o.name.toUpperCase()) + tag + '</button>';
    }).join('');
    var on = $('#chips [aria-pressed=true]'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    $('#card').innerHTML = cardHtml(s);
    document.documentElement.style.setProperty('--cardH', $('#card').offsetHeight + 'px');
    paintPins();
  }
  function cardHtml(s) {
    var v = WX[s.id], b = best(v), err = WXERR[s.id] === 'down', regN = SPOTS.filter(function (o) { return o.reg === s.reg; }).length;
    var idx = SPOTS.filter(function (o) { return o.reg === s.reg; }).indexOf(s) + 1;
    var big = '', line = '', week = '', go = '';
    var open = !!s.city;
    var link = '../?city=' + s.city + '&spot=' + encodeURIComponent(s.id) + '&sport=' + (s.kind === 'mtb' ? 'mtb' : 'kite') + '#start';
    if (s.kind === 'rental') {
      big = 'RENT';
      line = '<b>[PARTNER NAME]</b> · kite and board rental by the beach. Rentals open on Hi8ctane soon: book it with your session.';
      go = '<button type="button" class="go" data-act="rent">RENTALS SOON</button>';
    } else if (s.mine) {
      big = 'NEW';
      line = 'Your spot, saved on this phone. We check new spots before they go on the map for everyone.';
      go = open ? '<a class="go" href="' + link + '">I\'M GOING</a>' : '<button type="button" class="go" data-act="trip">CREWS SOON</button>';
    } else if (!v) {
      big = err ? '—' : '··';
      line = err ? 'The forecast can\'t be reached right now. Try again in a minute.' : 'Getting the forecast…';
      go = open ? '<a class="go" href="' + link + '">I\'M GOING</a>' : '<button type="button" class="go" data-act="trip">CREWS SOON</button>';
    } else {
      var d = S.day != null ? Object.assign({ i: S.day }, v.days[S.day]) : b;
      if (v.kind === 'kite') {
        big = d && d.kt != null ? d.kt + '<small>KT ' + d.dow + '</small>' : '—';
        line = d && d.kt != null ? (S.day == null ? 'BEST THIS WEEK: ' : '') + '<b>' + d.dow + ' ' + pad2(d.from) + '–' + pad2(d.from + 3) + ' · ' + d.kt + ' KT ' + d.dir + '</b> · gusts ' + d.gust : 'No wind data for this day.';
        if (v.now) line += ' · now ' + v.now.kt + ' ' + v.now.dir;
        week = '<div class="week">' + v.days.map(function (x, i) {
          return '<button type="button" data-day="' + i + '" class="' + (x.kt != null ? ktTone(x.kt) : 't-no') + '" aria-pressed="' + (d && d.i === i) + '"><span>' + x.dow + '</span><b>' + (x.kt != null ? x.kt : '–') + '</b></button>';
        }).join('') + '</div>';
      } else {
        big = d ? (d.mm < 0.5 ? 'DRY' : Math.round(d.mm) + '<small>MM</small>') + '<small>' + d.dow + '</small>' : '—';
        line = d ? (S.day == null ? 'DRIEST DAY: ' : '') + '<b>' + d.dow + ' · ' + (Math.round(d.mm * 10) / 10) + ' MM RAIN' + (d.tmax != null ? ' · ' + Math.round(d.tmax) + '°' : '') + '</b>' : '';
        week = '<div class="week">' + v.days.map(function (x, i) {
          return '<button type="button" data-day="' + i + '" class="' + rainTone(x.mm) + '" aria-pressed="' + (d && d.i === i) + '"><span>' + x.dow + '</span><b>' + (x.mm < 0.5 ? 'DRY' : Math.round(x.mm)) + '</b></button>';
        }).join('') + '</div>';
      }
      go = open ? '<a class="go" href="' + link + '">I\'M GOING</a>' : '<button type="button" class="go" data-act="trip">CREWS SOON</button>';
    }
    return '<div class="row"><span class="tag ' + s.kind + '">' + (s.kind === 'rental' ? 'RENTAL' : s.kind.toUpperCase()) + '</span><span class="where">' + (s.trip ? 'ROAD TRIP · ' : '') + s.reg + ' · ' + idx + '/' + regN + '</span></div>' +
      '<div class="row"><span class="nm">' + esc(s.name) + '</span><span class="big">' + big + '</span></div>' +
      '<div class="line">' + line + '</div>' + week +
      '<div class="acts"><button type="button" data-act="prev" aria-label="Previous spot">‹</button>' + go + '<button type="button" data-act="next" aria-label="Next spot">›</button></div>' +
      (v ? '<div class="src">Forecast: Open-Meteo · ' + new Date(v.at).toTimeString().slice(0, 5) + '</div>' : '');
  }
  function pad2(h) { return (h < 10 ? '0' : '') + h; }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (t.dataset.reg) { for (var i = 0; i < SPOTS.length; i++) if (SPOTS[i].reg === t.dataset.reg) { pick(i); return; } }
    if (t.dataset.i) return pick(+t.dataset.i);
    if (t.dataset.day) { S.day = +t.dataset.day === S.day ? null : +t.dataset.day; paint(); return; }
    if (t.dataset.look) return setLook(t.dataset.look);
    var a = t.dataset.act;
    if (a === 'globe') return globe();
    if (a === 'trip') return sheet('<h2>CREWS HERE SOON</h2><p>We open crews spot by spot, starting with Noord-Holland, Barcelona and Tarifa. The forecast here is already real: when this spot opens, you post a crew and share the drive.</p><div class="two"><button type="button" data-act="close">OK</button><button type="button" class="ok" data-act="close">GOT IT</button></div>');
    if (a === 'prev') return step(-1);
    if (a === 'next') return step(1);
    if (a === 'rent') return sheet('<h2>RENTALS ARE COMING</h2><p>We\'re signing kite schools and rental shops in Tarifa and Barcelona. Soon you book the gear with the session, in one tap.</p><div class="two"><button type="button" data-act="close">OK</button><button type="button" class="ok" data-act="close">GOT IT</button></div>');
    if (a === 'close') return closeSheet();
    if (a === 'save') return saveSpot();
    if (t.id === 'addBtn') return startAdd();
  });
  function step(d) {
    var s = SPOTS[S.sel], list = [];
    SPOTS.forEach(function (o, i) { if (o.reg === s.reg) list.push(i); });
    var k = list.indexOf(S.sel) + d;
    if (k < 0 || k >= list.length) { // next region
      var r = (REGS.indexOf(s.reg) + (d > 0 ? 1 : -1) + REGS.length) % REGS.length;
      list = []; SPOTS.forEach(function (o, i) { if (o.reg === REGS[r]) list.push(i); });
      k = d > 0 ? 0 : list.length - 1;
    }
    pick(list[k]);
  }
  document.addEventListener('keydown', function (e) {
    if (S.adding || /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
  });
  function setLook(l) {
    if (l === S.look) return;
    S.look = l; document.body.className = l;
    try { localStorage.setItem('hi8.world.look', l); } catch (e) { /* fine */ }
    document.querySelectorAll('.looks button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.look === l)); });
    map.setStyle(style(l), { diff: false });
    if (S.sel >= 0) { var s = SPOTS[S.sel]; try { history.replaceState(null, '', '?spot=' + s.id + (l === 'topo' ? '&look=topo' : '')); } catch (e) { /* fine */ } }
  }
  document.querySelectorAll('.looks button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.look === S.look)); });

  // ---------- add a spot ----------
  function sheet(html) { var el = $('#sheet'); el.innerHTML = html; el.hidden = false; $('#card').style.visibility = 'hidden'; }
  function closeSheet() { $('#sheet').hidden = true; $('#hint').hidden = true; $('#card').style.visibility = ''; S.adding = false; }
  function startAdd() {
    S.adding = true; stopOrbit(); userBusy = true;
    var h = $('#hint'); h.innerHTML = '<span class="x"></span><span class="t">MOVE THE MAP: THE CIRCLE ON THE SPOT</span>'; h.hidden = false;
    sheet('<h2>ADD A SPOT</h2><p>Put the circle on the launch or the trailhead, give it a name and pick the sport.</p>' +
      '<label>NAME<input id="nsName" maxlength="40" autocomplete="off" placeholder="e.g. Hargen aan Zee"></label>' +
      '<label>SPORT<select id="nsSport"><option value="kite">Kite</option><option value="mtb">MTB</option></select></label>' +
      '<div class="two"><button type="button" data-act="close">CANCEL</button><button type="button" class="ok" data-act="save">ADD IT</button></div>');
  }
  function saveSpot() {
    var name = ($('#nsName').value || '').trim(); if (!name) { $('#nsName').focus(); return; }
    var c = map.getCenter(), s = SPOTS[S.sel] || SPOTS[0];
    var m = { id: 'mine-' + Date.now().toString(36), city: s.city, reg: s.reg, name: name, kind: $('#nsSport').value, lat: +c.lat.toFixed(4), lon: +c.lng.toFixed(4), bearing: map.getBearing(), zoom: Math.max(12, map.getZoom()), mine: true };
    mine.push(m); SPOTS.push(m);
    try { localStorage.setItem('hi8.world.mine', JSON.stringify(mine)); } catch (e) { /* fine */ }
    closeSheet(); makePins(); pick(SPOTS.length - 1);
  }

  // ---------- start ----------
  // start as soon as the style is in (not on 'load', which waits for every tile and never comes if a tile server is down)
  var started = false;
  map.once('style.load', start); setTimeout(start, 3500);
  // the vector tiles can't be reached: fall back to the light coastline so the page still works
  var omtOk = false;
  map.on('sourcedata', function (e) { if (e.sourceId === 'omt' && e.isSourceLoaded) omtOk = true; });
  map.on('error', function (e) {
    if (OFFLINE || omtOk || !e || e.sourceId !== 'omt') return;
    OFFLINE = true; map.setStyle(style(S.look), { diff: false });
  });
  function start() {
    if (started) return; started = true;
    makePins(); zoomClass();
    var want = Q.get('spot'), i0 = 0;
    SPOTS.forEach(function (s, i) { if (s.id === want) i0 = i; });
    S.sel = i0; SPOTS.forEach(function (o) { if (o.reg === SPOTS[i0].reg) load(o); });
    if (!want && !REDUCED) { S.globe = true; paintGlobe(); spin(); setTimeout(function () { if (S.globe) { S.globe = false; pick(i0); } }, 2600); return; }
    paint();
    setTimeout(function () { fly(i0, true); }, REDUCED ? 0 : 700);
  }
  window.addEventListener('resize', function () { if (S.sel >= 0) document.documentElement.style.setProperty('--cardH', $('#card').offsetHeight + 'px'); });
})();
