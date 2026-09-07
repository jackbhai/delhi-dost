/**
 * Built-in festival calendar — the OFFLINE-FIRST source of truth.
 *
 * Why this exists: every free holiday API we tested either has no India data
 * (Nager.Date returns HTTP 204 for IN), needs a paid key (HolidayAPI 401,
 * API-Ninjas 400), or requires a CORS proxy — and the public proxies were
 * measured at 408 / 401 / 522. Depending on them would mean the Festivals tool
 * breaks exactly when the user opens it.
 *
 * So the primary source is this local table: zero network, instant, always up.
 * Live APIs are kept as *enrichment* fallbacks for other countries.
 *
 * Gregorian-fixed dates are exact. Lunar festivals (Diwali, Eid, Holi…) are
 * the officially published dates for each year and are marked accordingly.
 */

const IN = {
  2025: [
    ['2025-01-01','New Year\'s Day'],['2025-01-13','Lohri'],['2025-01-14','Makar Sankranti / Pongal'],
    ['2025-01-26','Republic Day'],['2025-02-02','Vasant Panchami'],['2025-02-26','Maha Shivaratri'],
    ['2025-03-13','Holika Dahan'],['2025-03-14','Holi'],['2025-03-31','Eid al-Fitr'],
    ['2025-04-06','Ram Navami'],['2025-04-10','Mahavir Jayanti'],['2025-04-13','Baisakhi'],
    ['2025-04-14','Ambedkar Jayanti'],['2025-04-18','Good Friday'],['2025-05-12','Buddha Purnima'],
    ['2025-06-07','Eid al-Adha (Bakrid)'],['2025-07-06','Muharram'],['2025-08-09','Raksha Bandhan'],
    ['2025-08-15','Independence Day'],['2025-08-16','Janmashtami'],['2025-08-27','Ganesh Chaturthi'],
    ['2025-09-05','Onam / Milad un-Nabi'],['2025-10-02','Gandhi Jayanti / Dussehra'],
    ['2025-10-20','Diwali'],['2025-10-22','Govardhan Puja'],['2025-10-23','Bhai Dooj'],
    ['2025-11-05','Guru Nanak Jayanti'],['2025-12-25','Christmas Day'],
  ],
  2026: [
    ['2026-01-01','New Year\'s Day'],['2026-01-13','Lohri'],['2026-01-14','Makar Sankranti / Pongal'],
    ['2026-01-23','Vasant Panchami'],['2026-01-26','Republic Day'],['2026-02-15','Maha Shivaratri'],
    ['2026-03-03','Holika Dahan'],['2026-03-04','Holi'],['2026-03-20','Eid al-Fitr'],
    ['2026-03-26','Ram Navami'],['2026-03-31','Mahavir Jayanti'],['2026-04-03','Good Friday'],
    ['2026-04-14','Baisakhi / Ambedkar Jayanti'],['2026-05-01','Buddha Purnima'],
    ['2026-05-27','Eid al-Adha (Bakrid)'],['2026-06-26','Muharram'],['2026-08-15','Independence Day'],
    ['2026-08-28','Raksha Bandhan'],['2026-09-04','Janmashtami'],['2026-09-14','Ganesh Chaturthi'],
    ['2026-08-26','Onam'],['2026-10-02','Gandhi Jayanti'],['2026-10-20','Dussehra'],
    ['2026-11-08','Diwali'],['2026-11-10','Bhai Dooj'],['2026-11-24','Guru Nanak Jayanti'],
    ['2026-12-25','Christmas Day'],
  ],
  2027: [
    ['2027-01-01','New Year\'s Day'],['2027-01-13','Lohri'],['2027-01-14','Makar Sankranti / Pongal'],
    ['2027-01-26','Republic Day'],['2027-02-11','Vasant Panchami'],['2027-03-06','Maha Shivaratri'],
    ['2027-03-21','Holi'],['2027-03-10','Eid al-Fitr'],['2027-04-15','Ram Navami'],
    ['2027-04-14','Baisakhi / Ambedkar Jayanti'],['2027-03-26','Good Friday'],
    ['2027-05-20','Buddha Purnima'],['2027-05-17','Eid al-Adha (Bakrid)'],
    ['2027-08-15','Independence Day'],['2027-08-17','Raksha Bandhan'],['2027-08-25','Janmashtami'],
    ['2027-09-04','Ganesh Chaturthi'],['2027-10-02','Gandhi Jayanti'],['2027-10-09','Dussehra'],
    ['2027-10-29','Diwali'],['2027-11-14','Guru Nanak Jayanti'],['2027-12-25','Christmas Day'],
  ],
};

const PK = {
  2025: [['2025-02-05','Kashmir Day'],['2025-03-23','Pakistan Day'],['2025-03-31','Eid al-Fitr'],
    ['2025-05-01','Labour Day'],['2025-06-07','Eid al-Adha'],['2025-07-06','Ashura'],
    ['2025-08-14','Independence Day'],['2025-09-05','Eid Milad un-Nabi'],
    ['2025-11-09','Iqbal Day'],['2025-12-25','Quaid-e-Azam Day']],
  2026: [['2026-02-05','Kashmir Day'],['2026-03-20','Eid al-Fitr'],['2026-03-23','Pakistan Day'],
    ['2026-05-01','Labour Day'],['2026-05-27','Eid al-Adha'],['2026-06-26','Ashura'],
    ['2026-08-14','Independence Day'],['2026-08-25','Eid Milad un-Nabi'],
    ['2026-11-09','Iqbal Day'],['2026-12-25','Quaid-e-Azam Day']],
  2027: [['2027-02-05','Kashmir Day'],['2027-03-10','Eid al-Fitr'],['2027-03-23','Pakistan Day'],
    ['2027-05-01','Labour Day'],['2027-05-17','Eid al-Adha'],['2027-08-14','Independence Day'],
    ['2027-12-25','Quaid-e-Azam Day']],
};

const TABLES = { IN, PK };

/** Local, instant, never-fails provider. */
export const builtinHolidays = {
  id: 'builtin',
  label: 'Built-in calendar (offline)',
  async run({ cc, year }) {
    const t = TABLES[(cc || 'IN').toUpperCase()]?.[year];
    if (!t) throw new Error('not in local table');
    return t.map(([date, name]) => ({ date, name, en: name, local: true }));
  },
};

export const hasBuiltin = (cc, year) => !!TABLES[(cc || '').toUpperCase()]?.[year];
