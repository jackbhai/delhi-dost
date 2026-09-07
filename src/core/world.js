/**
 * Country reference data + emergency numbers.
 *
 * WHY NOT restcountries
 *   The app's Countries tool called restcountries.com, which is now DEPRECATED
 *   on every version — /v3.1, /v3 and /v4 all return
 *   {"success":false,"errors":[{"message":"This API version has been
 *   deprecated..."}]}. That tool has been quietly broken.
 *
 * WHAT REPLACED IT — all verified live with a real CORS header:
 *   mledoze/countries (jsDelivr)  250 countries, the richest single file:
 *                                 names, capital, region, population, area,
 *                                 currencies, languages, dialling codes,
 *                                 timezones, borders, flag, maps
 *   samayo/country-json           per-topic lists, 243-245 countries each,
 *                                 used to fill any gap
 *   countriesnow.space            capital / flags / cities lookups
 *
 * Both CDN sources are static files on jsDelivr, so there is no rate limit and
 * nothing to go down independently of GitHub.
 *
 * EMERGENCY NUMBERS
 *   emergencynumberapi.com is 404 on every endpoint, so the numbers below are
 *   a checked table rather than a live call. Each entry was taken from the
 *   country's official emergency service listing. A wrong number here is
 *   genuinely dangerous, so the table only contains countries that could be
 *   confirmed, and the UI says plainly when a country is not in it.
 */
import { jget } from './engine';

const CDN = 'https://cdn.jsdelivr.net/gh';
const MLEDOZE = `${CDN}/mledoze/countries@master/countries.json`;

let ALL = null;

/** Every country, normalised. One fetch, cached for the session. */
export async function allCountries() {
  if (ALL) return ALL;
  const raw = await jget(MLEDOZE, { ms: 20000 });
  ALL = raw.map((c) => {
    const cur = Object.entries(c.currencies || {})[0];
    return {
      cca2: c.cca2,
      cca3: c.cca3,
      name: c.name?.common || '',
      official: c.name?.official || '',
      native: Object.values(c.name?.native || {})[0]?.common || '',
      capital: (c.capital || [])[0] || '',
      region: c.region || '',
      subregion: c.subregion || '',
      population: c.population || 0,
      area: c.area || 0,
      /* mledoze stores the dialling code split into root + suffixes, e.g.
         root "+9" suffix "1" for India. Joining them is the only way to get
         a usable number. */
      dial: (c.idd?.root || '') + ((c.idd?.suffixes || [])[0] || ''),
      dialAll: (c.idd?.suffixes || []).map((s) => (c.idd?.root || '') + s),
      currency: cur ? { code: cur[0], name: cur[1]?.name, symbol: cur[1]?.symbol } : null,
      languages: Object.values(c.languages || {}),
      timezones: c.timezones || [],
      borders: c.borders || [],
      flag: `https://flagcdn.com/w320/${(c.cca2 || '').toLowerCase()}.png`,
      flagEmoji: c.flag || '',
      maps: c.maps?.googleMaps || '',
      tld: (c.tld || [])[0] || '',
      independent: c.independent !== false,
      unMember: !!c.unMember,
    };
  }).filter((c) => c.cca2)
    .sort((a, b) => a.name.localeCompare(b.name));
  return ALL;
}

export async function findCountry(q) {
  const s = String(q || '').toLowerCase().trim();
  if (!s) return [];
  const list = await allCountries();
  return list.filter((c) =>
    c.name.toLowerCase().includes(s) ||
    c.official.toLowerCase().includes(s) ||
    c.cca2.toLowerCase() === s ||
    c.cca3.toLowerCase() === s ||
    c.capital.toLowerCase().includes(s));
}

export async function countryByCode(code) {
  const list = await allCountries();
  const c = String(code || '').toUpperCase();
  return list.find((x) => x.cca2 === c || x.cca3 === c) || null;
}

/** Find a country from a dialling code, longest prefix first. */
export async function countryByDial(dial) {
  const d = String(dial || '').replace(/[^\d+]/g, '');
  if (!d) return [];
  const want = d.startsWith('+') ? d : '+' + d;
  const list = await allCountries();
  const hits = list.filter((c) => c.dialAll.some((x) => x && want.startsWith(x)));
  return hits.sort((a, b) => (b.dial?.length || 0) - (a.dial?.length || 0));
}

/* ------------------------------------------------------- emergency numbers
   Confirmed against each country's official emergency service. Anything that
   could not be confirmed is simply absent — a wrong number here could cost
   someone real time in an emergency. */
export const EMERGENCY = {
  IN: { police: '100', fire: '101', ambulance: '102', unified: '112',
        extra: [['Women helpline', '1091'], ['Child helpline', '1098'],
                ['Disaster', '108'], ['Senior citizen', '14567'],
                ['Railway', '139'], ['Road accident', '1073'],
                ['Cyber crime', '1930'], ['Mental health (Tele-MANAS)', '14416']] },
  PK: { police: '15', fire: '16', ambulance: '1122', unified: '15',
        extra: [['Edhi ambulance', '115'], ['Women helpline', '1099']] },
  BD: { police: '999', fire: '999', ambulance: '999', unified: '999' },
  LK: { police: '119', fire: '110', ambulance: '1990', unified: '119' },
  NP: { police: '100', fire: '101', ambulance: '102', unified: '100' },
  AE: { police: '999', fire: '997', ambulance: '998', unified: '999' },
  SA: { police: '999', fire: '998', ambulance: '997', unified: '911' },
  QA: { police: '999', fire: '999', ambulance: '999', unified: '999' },
  KW: { police: '112', fire: '112', ambulance: '112', unified: '112' },
  OM: { police: '9999', fire: '9999', ambulance: '9999', unified: '9999' },
  BH: { police: '999', fire: '999', ambulance: '999', unified: '999' },
  US: { police: '911', fire: '911', ambulance: '911', unified: '911' },
  CA: { police: '911', fire: '911', ambulance: '911', unified: '911' },
  GB: { police: '999', fire: '999', ambulance: '999', unified: '112' },
  IE: { police: '999', fire: '999', ambulance: '999', unified: '112' },
  AU: { police: '000', fire: '000', ambulance: '000', unified: '112' },
  NZ: { police: '111', fire: '111', ambulance: '111', unified: '111' },
  SG: { police: '999', fire: '995', ambulance: '995', unified: '999' },
  MY: { police: '999', fire: '994', ambulance: '999', unified: '999' },
  TH: { police: '191', fire: '199', ambulance: '1669', unified: '191' },
  ID: { police: '110', fire: '113', ambulance: '118', unified: '112' },
  PH: { police: '911', fire: '911', ambulance: '911', unified: '911' },
  CN: { police: '110', fire: '119', ambulance: '120', unified: '110' },
  JP: { police: '110', fire: '119', ambulance: '119', unified: '110' },
  KR: { police: '112', fire: '119', ambulance: '119', unified: '112' },
  DE: { police: '110', fire: '112', ambulance: '112', unified: '112' },
  FR: { police: '17', fire: '18', ambulance: '15', unified: '112' },
  IT: { police: '113', fire: '115', ambulance: '118', unified: '112' },
  ES: { police: '091', fire: '080', ambulance: '061', unified: '112' },
  NL: { police: '112', fire: '112', ambulance: '112', unified: '112' },
  BE: { police: '101', fire: '112', ambulance: '112', unified: '112' },
  CH: { police: '117', fire: '118', ambulance: '144', unified: '112' },
  AT: { police: '133', fire: '122', ambulance: '144', unified: '112' },
  SE: { police: '112', fire: '112', ambulance: '112', unified: '112' },
  NO: { police: '112', fire: '110', ambulance: '113', unified: '112' },
  DK: { police: '112', fire: '112', ambulance: '112', unified: '112' },
  FI: { police: '112', fire: '112', ambulance: '112', unified: '112' },
  PL: { police: '997', fire: '998', ambulance: '999', unified: '112' },
  PT: { police: '112', fire: '112', ambulance: '112', unified: '112' },
  GR: { police: '100', fire: '199', ambulance: '166', unified: '112' },
  TR: { police: '155', fire: '110', ambulance: '112', unified: '112' },
  RU: { police: '102', fire: '101', ambulance: '103', unified: '112' },
  UA: { police: '102', fire: '101', ambulance: '103', unified: '112' },
  ZA: { police: '10111', fire: '10177', ambulance: '10177', unified: '112' },
  NG: { police: '112', fire: '112', ambulance: '112', unified: '112' },
  KE: { police: '999', fire: '999', ambulance: '999', unified: '112' },
  EG: { police: '122', fire: '180', ambulance: '123', unified: '122' },
  BR: { police: '190', fire: '193', ambulance: '192', unified: '190' },
  AR: { police: '911', fire: '100', ambulance: '107', unified: '911' },
  MX: { police: '911', fire: '911', ambulance: '911', unified: '911' },
  IL: { police: '100', fire: '102', ambulance: '101', unified: '112' },
};

export const emergencyFor = (cca2) => EMERGENCY[String(cca2 || '').toUpperCase()] || null;

/**
 * India's national helplines — the numbers people actually need.
 * Published by the relevant ministry or authority in each case.
 */
export const INDIA_HELPLINES = [
  ['Emergency (all services)', '112', 'One number for police, fire and ambulance'],
  ['Police', '100', ''],
  ['Fire', '101', ''],
  ['Ambulance', '102', 'Also 108 in most states'],
  ['Disaster management', '108', ''],
  ['Women helpline', '1091', '24x7, national'],
  ['Women helpline (domestic abuse)', '181', ''],
  ['Child helpline', '1098', 'Childline India'],
  ['Senior citizen helpline', '14567', 'Elderline'],
  ['Mental health (Tele-MANAS)', '14416', 'Free, 24x7, 20 languages'],
  ['Suicide prevention (KIRAN)', '1800-599-0019', '24x7, 13 languages'],
  ['Cyber crime', '1930', 'Report financial fraud immediately'],
  ['Railway enquiry', '139', ''],
  ['Railway security', '182', 'RPF'],
  ['Road accident', '1073', ''],
  ['Highway patrol', '1033', 'National highways'],
  ['Anti-poison', '1066', 'AIIMS'],
  ['Blood bank', '104', ''],
  ['AIDS helpline', '1097', ''],
  ['LPG gas leak', '1906', ''],
  ['Electricity complaint', '1912', ''],
  ['Consumer helpline', '1915', 'National Consumer Helpline'],
  ['Income tax', '1800-180-1961', ''],
  ['Aadhaar / UIDAI', '1947', ''],
  ['EPFO', '14470', ''],
  ['Kisan call centre', '1800-180-1551', 'Farming advice'],
  ['Tourist helpline', '1363', 'Multilingual'],
  ['Anti-corruption', '1064', ''],
  ['Missing child / woman', '1094', ''],
  ['Air ambulance', '9540161344', ''],
];
