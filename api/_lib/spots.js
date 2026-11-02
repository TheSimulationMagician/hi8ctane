// Launch spots for the week board. good_from/good_to = the wind directions (degrees, "from") that blow on or
// along this beach: inside the range is safe for kite and wing; outside it is offshore. Barcelona values are
// first estimates: the city lead checks each spot card before launch.
export const CITIES = {
  ams: { name: 'Amsterdam', tz: 'Europe/Amsterdam', spots: [
    { id: 'wijk', name: 'Wijk aan Zee', lat: 52.496, lon: 4.582, sports: ['kite', 'wing', 'surf'], good_from: 200, good_to: 320 },
    { id: 'ijmuiden', name: 'IJmuiden', lat: 52.46, lon: 4.555, sports: ['kite', 'wing'], good_from: 200, good_to: 340 },
    { id: 'zandvoort', name: 'Zandvoort', lat: 52.373, lon: 4.523, sports: ['surf', 'kite'], good_from: 200, good_to: 330 },
    { id: 'sloterplas', name: 'Sloterplas', lat: 52.365, lon: 4.81, sports: ['sup'], lake: true },
    { id: 'schoorl', name: 'Schoorl dunes', lat: 52.701, lon: 4.687, sports: ['mtb'] },
  ] },
  bcn: { name: 'Barcelona', tz: 'Europe/Madrid', spots: [
    { id: 'castelldefels', name: 'Castelldefels', lat: 41.268, lon: 1.985, sports: ['kite', 'wing'], good_from: 90, good_to: 250 },
    { id: 'masnou', name: 'Masnou', lat: 41.476, lon: 2.318, sports: ['surf'], good_from: 60, good_to: 220 },
    { id: 'barceloneta', name: 'Barceloneta', lat: 41.378, lon: 2.193, sports: ['sup', 'surf'], good_from: 60, good_to: 220 },
    { id: 'collserola', name: 'Collserola', lat: 41.418, lon: 2.115, sports: ['mtb'] },
  ] },
};
export const SPORT_ORDER = ['kite', 'wing', 'surf', 'sup', 'mtb'];
