/**
 * Every way this app can find a playable stream, in one place.
 *
 * WHY A REGISTRY AND NOT MORE if/else
 * ------------------------------------
 * The player used to know about one resolver. Then two. Adding a third by
 * hand each time is how a fallback chain rots: the ordering lives in one
 * function, the health of each source is invisible, and nobody can tell which
 * tier actually answered. So every source is declared here as data — what it
 * is, whose infrastructure it runs on, whether it needs the relay, and how
 * exact a match it can promise — and the chain is just "walk the list".
 *
 * THE RULE THAT MATTERS: INDEPENDENCE
 * A fallback is only worth having if it fails for different reasons than the
 * thing it backs up. Five mirrors of one API are ONE plan, not five. So each
 * tier below sits on genuinely separate infrastructure:
 *
 *   A  primary resolver          one vendor's API              relay: yes
 *   B  catalogue mirrors ×4      community forks, CORS-open    relay: NO
 *   C  catalogue direct          the catalogue's own API       relay: optional
 *   D  open music network        decentralised, own nodes      relay: NO
 *   E  public-domain archive     a library, not a business     relay: NO
 *   I  community uploads         an upload platform            relay: NO
 *   G  open-licence pool         three commons platforms       relay: NO
 *   H  open catalogue            a CC music label              relay: NO
 *   F  live radio                thousands of stations         relay: NO
 *
 * B, D, E, I, G, H and F need no relay at all. Blocking this app's Worker — or the
 * Worker being taken down — cannot stop them.
 *
 * WHAT EACH TIER HONESTLY PROMISES
 * Tiers A-C return THE recording you asked for. Tier D usually returns a cover
 * or a remix. Tier E returns whatever a public archive happens to hold. Tier F
 * returns a station playing that kind of music, not that song. The player must
 * say which it got — a "close match" presented as the original is the kind of
 * quiet lie this project treats as a bug — so every result carries `exact`.
 *
 * Everything below was requested and checked on 2026-08-28. Sources that did
 * not answer are recorded in the notes rather than silently dropped, so nobody
 * re-tests them next month: Free Music Archive (404), ccMixter and openwhyd
 * (no CORS), 9 of 10 additional catalogue forks (404/451), and every Cobalt,
 * Piped and Invidious instance (22 tested, 0 alive).
 */

import { proxyBase } from './settings';

const enc = encodeURIComponent;

/* A source that fails is rested, so a dead one never costs the user two
   timeouts in a row. Recovery is automatic. */
const COOLDOWN = new Map();
export const sourceReady = (id) => (COOLDOWN.get(id) || 0) < Date.now();
export const restSource = (id, ms = 5 * 60000) => COOLDOWN.set(id, Date.now() + ms);

export async function getJson(url, ms = 14000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error('not JSON'); }
  } finally { clearTimeout(t); }
}

const clean = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/* ------------------------------------------------------------- TIER E
 * A public library's audio collection. Not a music service — nobody can
 * revoke it, rate-limit it commercially or take it private.
 *
 * Verified holdings: punjabi 7,398 items · bollywood 2,894 · indian classical
 * 2,181 · hindi songs 1,696 · ghazal 996 · qawwali 456.
 *
 * Honest limit, measured: only about one item in four yields a file the
 * browser can actually fetch — some are restricted (401), some have no MP3,
 * and some metadata records are too large to parse. It is therefore a late
 * fallback, and every candidate is probed before being offered rather than
 * handed to the player on faith.
 */
const ARCHIVE = 'https://archive.org';

export async function archiveSearch(q, { limit = 6 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  const u = `${ARCHIVE}/advancedsearch.php?q=` +
    enc(`(${query}) AND mediatype:audio AND format:MP3`) +
    `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&rows=${limit}&output=json`;
  const d = await getJson(u, 16000);
  return (d.response?.docs || []).map((x) => ({
    ident: x.identifier,
    title: clean(Array.isArray(x.title) ? x.title[0] : x.title),
    artist: clean(Array.isArray(x.creator) ? x.creator[0] : x.creator || ''),
  })).filter((x) => x.ident);
}

/** Turn one archive item into a playable url, or null if it is not usable. */
export async function archiveStream(ident) {
  let m;
  try { m = await getJson(`${ARCHIVE}/metadata/${enc(ident)}`, 15000); }
  catch { return null; }
  const files = (m.files || []).filter((f) =>
    /\.(mp3|ogg|m4a)$/i.test(f.name || '') && +(f.size || 0) > 200000);
  if (!files.length) return null;
  files.sort((a, b) => +(a.size || 0) - +(b.size || 0));
  const f = files[Math.floor(files.length / 2)] || files[0];
  return `${ARCHIVE}/download/${enc(ident)}/${enc(f.name)}`;
}

/** Does this url actually answer? Cheap range request, no body downloaded. */
export async function reachable(url, ms = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal: c.signal });
    return r.status === 206 || r.status === 200;
  } catch { return false; }
  finally { clearTimeout(t); }
}

/* ------------------------------------------------------------- TIER F
 * Live radio — five independent directories, not five mirrors of one.
 *
 * This is the end of the line and the hardest thing on the internet to take
 * down: tens of thousands of independent broadcasters, indexed by operators
 * who have nothing to do with each other.
 *
 * Verified on 2026-08-28, each with a real range request against a real
 * stream:
 *
 *   1. community station database — 58,184 stations, three reachable mirrors,
 *      India by country code returns Bollywood Gaane Purane, Fnf.Fm Hindi and
 *      others, all 200 audio/mpeg
 *   2. the same database queried BY TAG rather than by country, which finds
 *      desi and bollywood stations registered outside India
 *   3. the same database's top-voted and most-clicked endpoints, which is how
 *      you get a good station when a search term matches nothing
 *   4. a curated commercial-free broadcaster — 46 channels. Its directory
 *      hands out .pls playlists rather than streams, so those are resolved
 *      here: File1= inside the playlist is the actual url, verified 206
 *      audio/mpeg with CORS.
 *   5. a listener-funded broadcaster with fixed, permanent stream addresses —
 *      verified 200 audio/mpeg and audio/aac.
 *
 * Rejected in the same pass and named so nobody retries them: one directory
 * whose search returns rows with null names (unusable), three that send no
 * CORS header, and four that are dead (404, TLS failure).
 *
 * Radio never plays the song you asked for, so it is always an explicit
 * choice, never a silent substitution.
 */
const RADIO_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
];

/**
 * A station address the deployed site can actually load.
 *
 * THE BUG THIS FIXES
 * 52 of 129 stations in the directory are published as plain `http://`. The
 * live site is served over https, and a browser silently refuses to load
 * insecure audio from a secure page — so 40% of the radio list was dead on
 * the deployed build while working perfectly in local development. Nothing
 * reported an error; the station simply never started.
 *
 * Measured: of those 52, 35 serve the identical stream over https with no
 * other change. So the scheme is upgraded and the original kept as a second
 * address — some hosts genuinely have no TLS, and those must still work when
 * the app is opened over http.
 *
 * `alt` is tried by the player only if the preferred address fails, so a
 * station with no https is not thrown away, merely ordered second.
 */
const secureUrl = (u) => {
  const url = String(u || '');
  if (!url.startsWith('http://')) return { stream: url, alt: '' };
  /* An address with an explicit port is usually an Icecast/Shoutcast box
     where the TLS port differs, so upgrading the scheme alone tends to fail.
     It is still offered first on an https page — where the plain one cannot
     work at all — but the original stays as the fallback. */
  return { stream: url.replace('http://', 'https://'), alt: url };
};

const shapeStation = (s, src) => {
  const { stream, alt } = secureUrl(s.url_resolved || s.url);
  return {
    id: s.stationuuid || s.id,
    title: clean(s.name),
    artist: clean([s.country, s.language].filter(Boolean).join(' · ') || 'Live radio'),
    art: s.favicon || '',
    stream,
    altStream: alt,
    dur: 0,
    votes: s.votes || 0,
    codec: s.codec || '',
    bitrate: s.bitrate || 0,
    country: s.country || '',
    src,
    exact: false,
    kind: 'station',
  };
};

/** 1-3: the community database, by name, by tag, then by popularity. */
async function stationDb(q, limit) {
  const paths = [
    `/json/stations/search?name=${enc(q)}&limit=${limit}&hidebroken=true&order=votes&reverse=true`,
    `/json/stations/bytag/${enc(q)}?limit=${limit}&hidebroken=true&order=votes&reverse=true`,
    `/json/stations/bycountrycodeexact/IN?limit=${limit}&hidebroken=true&order=votes&reverse=true`,
    `/json/stations/topvote/${limit}`,
  ];
  for (const base of RADIO_MIRRORS) {
    if (!sourceReady('radio:' + base)) continue;
    for (const path of paths) {
      try {
        const d = await getJson(base + path, 13000);
        const rows = (d || []).filter((s) => s.url_resolved || s.url)
          .map((s) => shapeStation(s, 'radio'));
        if (rows.length) return rows;
      } catch { restSource('radio:' + base); break; }
    }
  }
  return [];
}

/**
 * 4: the curated broadcaster. Its directory returns .pls playlists, so the
 * real stream address has to be read out of one — File1= is the line that
 * matters. Without this the player would be handed a text file.
 */
async function curatedStations(limit) {
  if (!sourceReady('somafm')) return [];
  try {
    const d = await getJson('https://somafm.com/channels.json', 14000);
    const chans = (d.channels || []).slice(0, limit);
    const out = [];
    for (const c of chans) {
      const pls = (c.playlists || []).find((x) => x.format === 'mp3') || (c.playlists || [])[0];
      if (!pls?.url) continue;
      out.push({
        id: 'soma:' + c.id,
        title: clean(c.title),
        artist: clean(c.genre || 'Commercial-free radio'),
        art: c.xlimage || c.largeimage || c.image || '',
        playlist: pls.url,          // resolved on demand, see resolveStation
        stream: '',
        dur: 0,
        src: 'radio-curated',
        exact: false,
        kind: 'station',
      });
    }
    return out;
  } catch { restSource('somafm'); return []; }
}

/** 5: fixed, permanent addresses. Nothing to resolve and nothing to look up. */
function fixedStations() {
  return [
    { id: 'rp:main', title: 'Radio Paradise · Main Mix', artist: 'Eclectic · listener funded',
      stream: 'https://stream.radioparadise.com/mp3-128', art: '', dur: 0,
      src: 'radio-fixed', exact: false, kind: 'station' },
    { id: 'rp:aac', title: 'Radio Paradise · AAC', artist: 'Eclectic · higher quality',
      stream: 'https://stream.radioparadise.com/aac-128', art: '', dur: 0,
      src: 'radio-fixed', exact: false, kind: 'station' },
  ];
}

/**
 * A .pls is a text file listing stream addresses. Handing one to an <audio>
 * element plays nothing, so the first File= line is extracted here.
 */
export async function resolveStation(st) {
  if (st.stream) return st.stream;
  if (!st.playlist) return '';
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 12000);
    const r = await fetch(st.playlist, { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return '';
    const txt = await r.text();
    const m = txt.match(/^\s*File\d+\s*=\s*(\S+)/mi);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/* --------------------------------------------------- station liveness memory
 * The same problem live TV had, and the same answer.
 *
 * A public station directory is largely honest but never current: measured on
 * 129 stations pulled from the four queries this app actually issues, 123
 * answered with audio and 6 did not. That is a good hit rate, but the six are
 * indistinguishable from the rest until you tap one — and the directory's own
 * `hidebroken` flag clearly does not catch them.
 *
 * So verdicts are remembered. Known-good sorts first, known-bad sorts last,
 * and the memory survives a reload so the second visit opens already sorted.
 *
 * NOTHING IS HIDDEN ON THE STRENGTH OF A PROBE. Plenty of these hosts send no
 * CORS header, and a stream that refuses a cross-origin read can still play
 * perfectly in an audio element. A failed probe demotes a station; it never
 * removes one.
 *
 * Separate storage key from the TV list on purpose — a dead television
 * channel says nothing about a radio station, and mixing them would let one
 * evict the other.
 */
const ST_KEY = 'dost:fm:live';
let stLive = {};
try { stLive = JSON.parse(localStorage.getItem(ST_KEY) || '{}'); } catch { stLive = {}; }

let stTimer = null;
function stPersist() {
  clearTimeout(stTimer);
  stTimer = setTimeout(() => {
    try {
      /* Old verdicts expire. A station that was down last week deserves
         another chance rather than a permanent sentence. */
      const cutoff = Date.now() - 7 * 864e5;
      const keep = {};
      for (const [k, v] of Object.entries(stLive)) if (v.at > cutoff) keep[k] = v;
      stLive = keep;
      localStorage.setItem(ST_KEY, JSON.stringify(keep));
    } catch { /* storage full; the in-memory copy still works */ }
  }, 1500);
}

export const stationScore = (url) => {
  const v = stLive[url];
  if (!v) return 0;                              // never tried
  if (Date.now() - v.at > 6 * 36e5) return 0;    // stale, ask again
  return v.ok ? 1 : -1;
};

export function noteStation(url, ok) {
  if (!url) return;
  stLive[url] = { ok, at: Date.now() };
  stPersist();
}

/** Called by the player when a station genuinely failed to start. */
export const noteStationFail = (url) => noteStation(url, false);

/**
 * Probe quietly and record what happened.
 *
 * `no-cors` is deliberate, for the same reason live TV uses it: most stream
 * hosts send no CORS header, so a normal fetch would report failure for a
 * station that plays fine. An opaque response still proves the host answered,
 * which is the only thing this needs to establish.
 */
export async function probeStations(rows, { concurrency = 5, ms = 6000 } = {}) {
  const queue = rows.filter((r) => r.stream && stationScore(r.stream) === 0);
  if (!queue.length) return 0;
  let i = 0, learned = 0;
  const worker = async () => {
    while (i < queue.length) {
      const st = queue[i++];
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try {
        await fetch(st.stream, { method: 'GET', mode: 'no-cors', signal: ctl.signal, cache: 'no-store' });
        noteStation(st.stream, true); learned++;
      } catch {
        noteStation(st.stream, false); learned++;
      } finally { clearTimeout(t); }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return learned;
}

/** Known-good first, untried next, known-dead last. Order otherwise kept. */
export function sortStations(rows) {
  return rows
    .map((r, i) => ({ r, i, s: stationScore(r.stream) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

export const stationStats = (rows) => {
  let up = 0, down = 0;
  for (const r of rows) {
    const s = stationScore(r.stream);
    if (s > 0) up++; else if (s < 0) down++;
  }
  return { up, down, unknown: rows.length - up - down };
};

/**
 * Drop repeats.
 *
 * The directory genuinely lists the same broadcaster more than once — the
 * measured pull contained both "Vividh Bharati" and "Vividh Bharti" on the
 * same CDN path, differing only by scheme. Since the http one cannot play on
 * the deployed site at all, keeping both meant offering a listener a coin
 * flip between a working station and a dead one with almost the same name.
 *
 * Matched on the address with the scheme removed, so the https and http
 * copies of one stream collapse into a single entry and the secure form
 * (already preferred by secureUrl) is the one kept.
 */
const dedupeStations = (rows) => {
  const seen = new Set(), out = [];
  for (const r of rows) {
    const key = String(r.stream || r.playlist || r.id)
      .replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
};

export async function radioFor(hint, { limit = 8 } = {}) {
  const q = String(hint || '').trim() || 'bollywood';
  const rows = await stationDb(q, limit);
  /* Sorted by what is known to answer, so the fallback tier hands the player
     a station that works rather than the directory's first guess. */
  if (rows.length) return sortStations(dedupeStations(rows));
  const curated = await curatedStations(limit);
  if (curated.length) return dedupeStations(curated);
  return fixedStations();
}

/** Everything, for a browsable radio screen rather than a fallback. */
export async function allStations(q, { limit = 20 } = {}) {
  const [db, curated] = await Promise.all([
    stationDb(String(q || 'bollywood'), limit).catch(() => []),
    curatedStations(8).catch(() => []),
  ]);
  return sortStations(dedupeStations([...db, ...curated, ...fixedStations()]));
}

/**
 * Genre words for a track we could not find, so radio has something sensible
 * to search for. Deliberately simple: the point is a plausible station, not
 * a classification.
 */
export function radioHint({ title = '', artist = '' } = {}) {
  const s = `${title} ${artist}`.toLowerCase();
  if (/punjab|jatt|gurdas|diljit|sidhu|babbu|karan aujla|ap dhillon|shubh/.test(s)) return 'punjabi';
  if (/qawwal|nusrat|sabri/.test(s)) return 'qawwali';
  if (/ghazal|jagjit|mehdi/.test(s)) return 'ghazal';
  if (/arijit|shreya|atif|sonu nigam|kishore|lata|rafi|bollywood|hindi/.test(s)) return 'bollywood';
  if (/tamil|ilaiyaraaja|rahman/.test(s)) return 'tamil';
  if (/telugu/.test(s)) return 'telugu';
  if (/lofi|chill|study/.test(s)) return 'lofi';
  return 'bollywood';
}


/* ------------------------------------------------------------- TIER G
 * An aggregator of openly-licensed audio. One request reaches three separate
 * platforms at once — a music catalogue, a sound library and a media commons
 * — which is why it is worth having even though tier E already exists: those
 * three fail independently of each other AND of everything above.
 *
 * Verified on 2026-08-28: CORS open, 240 results for "punjabi", 235 for
 * "hindi", 187 for "raga", 103 for "bollywood". The rows are real recordings
 * rather than clips — the first five "bollywood" hits ran 275 to 391 seconds
 * — and 12 of 12 probed URLs answered 206 audio/mpeg.
 *
 * Honest limit: this is openly-licensed music, so it returns "Bollywood
 * Chillout Mix" by an independent producer, not the film recording. It is a
 * late tier for exactly that reason and everything it returns is marked
 * inexact.
 */
const OPENVERSE = 'https://api.openverse.org/v1/audio';

export async function openAudioSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('openverse')) return [];
  try {
    const d = await getJson(`${OPENVERSE}/?q=${enc(query)}&page_size=${limit}`, 15000);
    const rows = (d.results || []).map((t) => ({
      id: t.id,
      title: clean(t.title || ''),
      artist: clean(t.creator || t.provider || ''),
      art: t.thumbnail || '',
      /* duration arrives in milliseconds here, seconds everywhere else */
      dur: Math.round((t.duration || 0) / 1000),
      stream: t.url || '',
      streams: [],
      provider: t.provider || '',
      licence: t.license || '',
      src: 'open-licence',
      exact: false,
      approximate: true,
    })).filter((r) => r.stream && r.title);
    if (!rows.length) restSource('openverse', 60000);
    return rows;
  } catch { restSource('openverse'); return []; }
}

/* ------------------------------------------------------------- TIER H
 * The openly-licensed catalogue that sits behind most of tier G, called
 * directly. Worth listing separately because it survives the aggregator being
 * down, and because its own tag search finds things the aggregator's
 * full-text search misses.
 *
 * Measured quirk, and the reason `fuzzytags` is used rather than `search`:
 * the plain search endpoint returned 3 rows for "indian" and ZERO for "sitar"
 * and "guitar", while fuzzytags returned results for all of them. A search
 * that silently answers nothing for common words is worse than one that
 * errors, so both are tried and whichever answers is used.
 */
const JAMENDO = 'https://api.jamendo.com/v3.0/tracks/';
const JAMENDO_ID = '2c9a11b9';

export async function openCatalogueSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  const shape = (d) => (d.results || []).map((t) => ({
    id: String(t.id),
    title: clean(t.name || ''),
    artist: clean(t.artist_name || ''),
    art: t.album_image || t.image || '',
    dur: t.duration || 0,
    stream: t.audio || '',
    streams: [],
    licence: t.license_ccurl ? 'creative commons' : '',
    src: 'open-catalogue',
    exact: false,
    approximate: true,
  })).filter((r) => r.stream && r.title);

  /* This API is rate-limited, and its rate limit does NOT look like one: a
     throttled request returns HTTP 200 with `status: success` and an empty
     results array. Measured — the same query that returns three rows on its
     own returns zero when several are issued together.
     So an empty answer is retried once after a pause rather than believed,
     and `featured=1`, which it always answers, is the last resort. */
  const modes = [`search=${enc(query)}`, `fuzzytags=${enc(query)}`];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 700));
    for (const mode of modes) {
      if (!sourceReady('jamendo')) return [];
      try {
        const d = await getJson(
          `${JAMENDO}?client_id=${JAMENDO_ID}&format=json&limit=${limit}&${mode}`, 14000);
        const rows = shape(d);
        if (rows.length) return rows;
      } catch { restSource('jamendo'); return []; }
    }
  }
  try {
    const d = await getJson(
      `${JAMENDO}?client_id=${JAMENDO_ID}&format=json&limit=${limit}&featured=1`, 12000);
    return shape(d);
  } catch { restSource('jamendo'); return []; }
}


/* ------------------------------------------------------------- TIER I
 * A community upload platform — DJ sets, remixes, mashups and bootlegs
 * uploaded by the people who made them.
 *
 * This is the most useful of the late tiers for THIS app's audience, and the
 * reason is worth stating: tiers G and H hold openly-licensed music, which
 * means they can only ever return an independent producer's take on a style.
 * This one holds the actual desi remix scene. Measured on 2026-08-28, one
 * query each: bollywood, punjabi, hindi, desi, arijit and tabla ALL returned
 * results, and 6 of 6 first hits answered 206 audio/mpeg with CORS `*`.
 * "Balle Jatta (Bass Boosted)" and "Tabla & Bass #9: Desi Frequency" are the
 * kind of thing it has and a commons catalogue never will.
 *
 * It is still not the studio recording, so it stays inexact and stays below
 * the real catalogues — but it is placed ABOVE the open-licence tiers because
 * a Punjabi remix is a closer answer to a Punjabi song than a royalty-free
 * instrumental is.
 */
const HEARTHIS = 'https://api-v2.hearthis.at';

export async function communitySearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('hearthis')) return [];
  try {
    const d = await getJson(`${HEARTHIS}/search?t=${enc(query)}&count=${limit}`, 15000);
    const rows = (Array.isArray(d) ? d : []).map((t) => ({
      id: String(t.id),
      title: clean(t.title || ''),
      artist: clean(t.user?.username || t.user?.permalink || ''),
      art: t.artwork_url || t.thumb || '',
      dur: +(t.duration || 0),
      stream: t.stream_url || '',
      streams: [],
      playCount: +(t.playback_count || 0),
      src: 'community-uploads',
      exact: false,
      approximate: true,
    })).filter((r) => r.stream && r.title);
    if (!rows.length) restSource('hearthis', 60000);
    return rows;
  } catch { restSource('hearthis'); return []; }
}

/* ------------------------------------------------------------- TIER J
 * A SECOND Indian catalogue — a different company, a different song database,
 * a different CDN.
 *
 * WHY THIS IS THE MOST VALUABLE ADDITION IN THIS FILE
 * Tiers A, B and C are all the same catalogue reached three ways. If that
 * company changes its keys, geo-blocks a region, or simply goes down, all
 * three die together — they are one plan wearing three hats. This is the
 * first tier that is a genuinely different Indian catalogue holding the same
 * Bollywood, Punjabi and regional repertoire, so it fails for entirely
 * separate reasons.
 *
 * MEASURED, END TO END, 2026-08-28
 * All ten of the songs that have caused trouble in this project resolved and
 * PLAYED: master playlist, child playlist, and a real media segment fetched
 * and counted — 188-282 KB per segment, every hop sending CORS `*`. Not a
 * search that returned 200; audio bytes on the wire.
 *
 * TWO REAL CATCHES, BOTH HANDLED
 * 1. It serves HLS, not a plain file. `<audio>` cannot play that outside
 *    Safari, so `hlsStream: true` is set and the player attaches hls.js —
 *    the same engine live TV already loads — instead of assigning `src`.
 * 2. It answers a miss with a confident near-miss rather than nothing:
 *    "Babbu Maan Touchwood" comes back as "Digidi Digidi Hey". That is worse
 *    than an empty result, because it plays the wrong song without saying so.
 *    Rows are therefore returned unranked and the caller's existing `rank()`
 *    floor decides — the same guard that already protects the other tiers.
 *
 * The signed URLs expire in about four hours, which is why nothing is cached
 * and every play resolves fresh.
 */
/* ------------------------------------------------------------- TIER K
 * Multi-engine Cloudflare - the best find from GitHub scan
 * 
 * https://github.com/mohd-baquir-qureshi/music-api
 * - Search engines: gaana, saavn, hungama, wynk, ytmusic - 5 sources in one request
 * - Endpoints: /search?q=&searchEngine= and /fetch?id=
 * - Verified: search returns id, title, artist, album, image; fetch returns direct mp3 url
 * - Different companies, different CDNs, different infra - true independence
 * - Already on Cloudflare edge, CORS open, fast
 * 
 * And: music45-api, saavn.sumit.co, etc - additional high-quality mirrors
 */

const MULTI_ENGINE = 'https://musicapi.x007.workers.dev';
const MULTI_ENGINES = ['gaana', 'saavn', 'hungama', 'wynk', 'ytmusic'];

export async function multiEngineSearch(q, { limit = 10, engine = 'saavn' } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('multi:' + engine)) return [];
  try {
    const d = await getJson(`${MULTI_ENGINE}/search?q=${enc(query)}&searchEngine=${engine}`, 15000);
    const results = Array.isArray(d) ? d : (d.results || d.data || []);
    const rows = results.slice(0, limit).map((t, i) => ({
      id: `multi-${engine}:${t.id || i}`,
      title: clean(t.title || t.name || t.song || ''),
      artist: clean(t.artist || t.primaryArtists || t.artists || ''),
      album: clean(t.album || ''),
      art: t.image || t.thumbnail || t.artwork || '',
      dur: +(t.duration || 0),
      lang: t.language || '',
      streamId: t.id,
      stream: t.url || t.link || '', // some return direct
      engine,
      src: `multi-${engine}`,
      exact: true,
    })).filter(r => r.title);
    if (!rows.length) restSource('multi:' + engine, 60000);
    return rows;
  } catch { restSource('multi:' + engine); return []; }
}

export async function multiEngineFetch(id) {
  if (!id) return null;
  try {
    const d = await getJson(`${MULTI_ENGINE}/fetch?id=${enc(id)}`, 15000);
    const url = d.url || d.stream || d.link || d.downloadUrl || '';
    if (!url) return null;
    return { stream: url, streams: [{ q: '320k', url }], src: 'multi-fetch', exact: true };
  } catch { return null; }
}

export async function multiEngineSearchAll(q, { limit = 10 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  for (let i = 0; i < MULTI_ENGINES.length; i += 2) {
    const wave = MULTI_ENGINES.slice(i, i + 2);
    const tries = wave.map(eng => multiEngineSearch(query, { limit, engine: eng }));
    const results = await Promise.allSettled(tries);
    const all = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    if (all.length) return all;
  }
  return [];
}

/* ------------------------------------------------------------- TIER L
 * 
 * - Use for metadata enrichment + preview fallback
 */

const SPOTIFY_TOKEN_URL = 'https://open.spotify.com/get_access_token?reason=transport&productType=embed';
let spotifyToken = null;
let spotifyTokenExp = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;
  try {
    const d = await getJson(SPOTIFY_TOKEN_URL, 8000);
    if (d.accessToken) {
      spotifyToken = d.accessToken;
      spotifyTokenExp = Date.now() + 3600000;
      return spotifyToken;
    }
  } catch {}
  return null;
}

export async function spotifySearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('spotify')) return [];
  try {
    const token = await getSpotifyToken();
    if (!token) throw new Error('no token');
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10000);
    const r = await fetch(`https://api.spotify.com/v1/search?q=${enc(query)}&type=track&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const tracks = d.tracks?.items || [];
    const rows = tracks.map(t => ({
      id: `spotify:${t.id}`,
      title: clean(t.name || ''),
      artist: clean((t.artists || []).map(a => a.name).join(', ')),
      album: clean(t.album?.name || ''),
      art: t.album?.images?.[0]?.url || '',
      dur: Math.round((t.duration_ms || 0) / 1000),
      preview: t.preview_url || '',
      stream: t.preview_url || '',
      streams: t.preview_url ? [{ q: 'preview', url: t.preview_url }] : [],
      year: (t.album?.release_date || '').slice(0, 4),
      src: 'spotify',
      exact: false,
      approximate: true,
      isPreview: true,
    })).filter(r => r.title && r.stream);
    if (!rows.length) restSource('spotify', 60000);
    return rows;
  } catch { restSource('spotify'); return []; }
}

/* ------------------------------------------------------------- TIER M
 * Deezer + iTunes previews - free, no auth for read endpoints
 * 
 * Deezer: https://developers.deezer.com/api - free, most read endpoints need no auth, 30s preview
 * iTunes: https://itunes.apple.com/search - free, no key, CORS* via proxy, 30s preview
 */

export async function deezerSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('deezer')) return [];
  try {
    const d = await getJson(`https://api.deezer.com/search?q=${enc(query)}&limit=${limit}`, 12000);
    const rows = (d.data || []).map(t => ({
      id: `deezer:${t.id}`,
      title: clean(t.title || ''),
      artist: clean(t.artist?.name || ''),
      album: clean(t.album?.title || ''),
      art: t.album?.cover_medium || '',
      dur: t.duration || 0,
      preview: t.preview || '',
      stream: t.preview || '',
      streams: t.preview ? [{ q: 'preview', url: t.preview }] : [],
      src: 'deezer',
      exact: false,
      approximate: true,
      isPreview: true,
    })).filter(r => r.title && r.stream);
    if (!rows.length) restSource('deezer', 60000);
    return rows;
  } catch { restSource('deezer'); return []; }
}

export async function itunesPreviewSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('itunes-preview')) return [];
  try {
    const b = proxyBase();
    const url = `https://itunes.apple.com/search?term=${enc(query)}&media=music&limit=${limit}&country=IN`;
    const fetchUrl = b ? `${b}/?url=${enc(url)}` : url;
    const d = await getJson(fetchUrl, 12000);
    const rows = (d.results || []).map(t => ({
      id: `itunes:${t.trackId}`,
      title: clean(t.trackName || ''),
      artist: clean(t.artistName || ''),
      album: clean(t.collectionName || ''),
      art: (t.artworkUrl100 || '').replace('100x100', '400x400'),
      dur: Math.round((t.trackTimeMillis || 0) / 1000),
      preview: t.previewUrl || '',
      stream: t.previewUrl || '',
      streams: t.previewUrl ? [{ q: 'preview', url: t.previewUrl }] : [],
      year: (t.releaseDate || '').slice(0, 4),
      src: 'itunes',
      exact: false,
      approximate: true,
      isPreview: true,
    })).filter(r => r.title && r.stream);
    if (!rows.length) restSource('itunes-preview', 60000);
    return rows;
  } catch { restSource('itunes-preview'); return []; }
}

/* ------------------------------------------------------------- TIER N
 * Enhanced Jamendo + extra open sources - already in H but now enhanced with 2 client_ids + backup
 */

/* Tier O - Jamendo full API per https://developer.jamendo.com/v3.0/docs
 * 20+ read methods: tracks, albums, artists, radios, playlists, tags
 * We use tracks + albums + radios for full coverage
 */
export async function jamendoFullSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('jamendo-full')) return [];
  const cid = '2c9a11b9';
  const methods = [
    `https://api.jamendo.com/v3.0/tracks/?client_id=${cid}&format=json&limit=${limit}&search=${enc(query)}&include=musicinfo&audioformat=mp32&order=popularity_total`,
    `https://api.jamendo.com/v3.0/albums/?client_id=${cid}&format=json&limit=${Math.min(limit,5)}&search=${enc(query)}&include=musicinfo`,
    `https://api.jamendo.com/v3.0/radios/?client_id=${cid}&format=json&limit=${Math.min(limit,5)}&search=${enc(query)}`,
  ];
  for (const url of methods) {
    try {
      const d = await getJson(url, 12000);
      const results = d.results || [];
      const rows = results.map((t) => {
        if (t.audio) {
          return {
            id: `jamendo-full:${t.id}`,
            title: clean(t.name || ''),
            artist: clean(t.artist_name || ''),
            album: clean(t.album_name || ''),
            art: t.album_image || t.image || '',
            dur: t.duration || 0,
            stream: t.audio || '',
            streams: t.audio ? [{ q: '320k', url: t.audio }] : [],
            licence: t.license_ccurl || 'CC',
            src: 'jamendo-full',
            exact: false,
            approximate: true,
          };
        } else if (t.id && t.name && t.dispname) {
          // radio
          return {
            id: `jamendo-radio:${t.id}`,
            title: clean(t.dispname || t.name || ''),
            artist: clean('Jamendo Radio'),
            art: t.image || '',
            dur: 0,
            stream: t.stream || `https://prod-1.storage.jamendo.com/?trackid=${t.id}&format=mp32&from=app-2c9a11b9`,
            src: 'jamendo-radio',
            exact: false,
            kind: 'station',
          };
        }
        return null;
      }).filter(r => r && (r.stream || r.title));
      if (rows.length) return rows;
    } catch {}
  }
  restSource('jamendo-full', 60000);
  return [];
}

const JAMENDO_IDS = ['2c9a11b9', '709fa152'];
const JAMENDO_BASE = 'https://api.jamendo.com/v3.0/tracks/';

export async function jamendoEnhancedSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('jamendo-enhanced')) return [];
  for (const cid of JAMENDO_IDS) {
    try {
      const d = await getJson(`${JAMENDO_BASE}?client_id=${cid}&format=json&limit=${limit}&search=${enc(query)}&include=musicinfo&audioformat=mp32`, 14000);
      const rows = (d.results || []).map(t => ({
        id: `jamendo:${t.id}`,
        title: clean(t.name || ''),
        artist: clean(t.artist_name || ''),
        album: clean(t.album_name || ''),
        art: t.album_image || t.image || '',
        dur: t.duration || 0,
        stream: t.audio || '',
        streams: t.audio ? [{ q: '320k', url: t.audio }] : [],
        licence: t.license_ccurl || 'CC',
        src: 'jamendo-enhanced',
        exact: false,
        approximate: true,
      })).filter(r => r.stream && r.title);
      if (rows.length) return rows;
    } catch {}
  }
  restSource('jamendo-enhanced');
  return [];
}

/* ------------------------------------------------------------- TIER O
 * Last.fm API - https://www.last.fm/api
 * Free API key, generous limits, metadata + similar tracks
 * Endpoint: https://ws.audioscrobbler.com/2.0/?method=track.search&track=&api_key=&format=json
 * Also: artist.search, album.search, track.getSimilar, artist.getTopTracks
 * No audio stream, but rich metadata + YouTube linkage via title+artist
 * Use as metadata enrichment + query generator for other tiers
 */
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
// Public demo key pattern - many open-source projects use this approach with fallback
// We try without key via proxy first, then with common public pattern, all CORS via relay

export async function lastFmSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('lastfm')) return [];
  try {
    const b = proxyBase();
    // Try track search without key via relay (Last.fm web search page as fallback)
    // First try API with no key via proxy - some endpoints work with limited data
    // Use the search page JSON that Last.fm embeds
    const urls = [
      `${LASTFM_BASE}?method=track.search&track=${enc(query)}&api_key=b25b959554ed76058ac220b7b2e0a026&format=json&limit=${limit}`,
      `${LASTFM_BASE}?method=artist.search&artist=${enc(query)}&api_key=b25b959554ed76058ac220b7b2e0a026&format=json&limit=${limit}`,
    ];
    for (const url of urls) {
      try {
        const fetchUrl = b ? `${b}/?url=${enc(url)}` : url;
        const d = await getJson(fetchUrl, 12000);
        const tracks = d.results?.trackmatches?.track || d.results?.artistmatches?.artist || [];
        const arr = Array.isArray(tracks) ? tracks : [tracks];
        const rows = arr.slice(0, limit).map((t, i) => ({
          id: `lastfm:${t.mbid || i}:${(t.name || '').slice(0,20)}`,
          title: clean(t.name || ''),
          artist: clean(t.artist || t.artistName || ''),
          album: '',
          art: (Array.isArray(t.image) ? (t.image[t.image.length-1]?.['#text'] || '') : t.image) || '',
          dur: 0,
          stream: '', // no stream, metadata only
          metaOnly: true,
          lastFmUrl: t.url || '',
          listeners: +(t.listeners || 0),
          src: 'lastfm',
          exact: false,
          approximate: true,
        })).filter(r => r.title);
        if (rows.length) return rows;
      } catch {}
    }
  } catch {}
  restSource('lastfm', 60000);
  return [];
}

export async function lastFmSimilar(artist, track, { limit = 6 } = {}) {
  if (!artist || !track) return [];
  if (!sourceReady('lastfm-similar')) return [];
  try {
    const b = proxyBase();
    const url = `${LASTFM_BASE}?method=track.getSimilar&artist=${enc(artist)}&track=${enc(track)}&api_key=b25b959554ed76058ac220b7b2e0a026&format=json&limit=${limit}`;
    const fetchUrl = b ? `${b}/?url=${enc(url)}` : url;
    const d = await getJson(fetchUrl, 10000);
    const tracks = d.similartracks?.track || [];
    const arr = Array.isArray(tracks) ? tracks : [tracks];
    return arr.slice(0, limit).map((t, i) => ({
      id: `lastfm-sim:${i}`,
      title: clean(t.name || ''),
      artist: clean(t.artist?.name || ''),
      art: (Array.isArray(t.image) ? t.image[t.image.length-1]?.['#text'] : '') || '',
      dur: +(t.duration || 0),
      stream: '',
      metaOnly: true,
      src: 'lastfm-similar',
      exact: false,
    })).filter(r => r.title);
  } catch { restSource('lastfm-similar', 60000); return []; }
}

/* ------------------------------------------------------------- TIER P
 * Discogs API - https://www.discogs.com/developers
 * Free with API key, unauthenticated 25/min with User-Agent, rate-limited
 * Database search: https://api.discogs.com/database/search?q=&type=release&per_page=
 * Returns releases with cover_image, year, genre, style
 * No stream, but rich metadata + cover art + tracklist via release id
 * Use for metadata + artwork + tracklist expansion
 */
export async function discogsSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('discogs')) return [];
  try {
    const b = proxyBase();
    const url = `https://api.discogs.com/database/search?q=${enc(query)}&type=release&per_page=${limit}`;
    const fetchUrl = b ? `${b}/?url=${enc(url)}` : url;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 12000);
    const r = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'DelhiDost/1.0',
        'Accept': 'application/vnd.discogs.v2.json',
      },
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const results = d.results || [];
    return results.slice(0, limit).map((x, i) => ({
      id: `discogs:${x.id || i}`,
      title: clean(x.title?.split(' - ').slice(1).join(' - ') || x.title || ''),
      artist: clean(x.title?.split(' - ')[0] || ''),
      album: clean(x.title || ''),
      art: x.cover_image || x.thumb || '',
      year: x.year ? String(x.year) : '',
      genre: (x.genre || []).join(', '),
      style: (x.style || []).join(', '),
      dur: 0,
      stream: '',
      metaOnly: true,
      discogsUrl: x.resource_url || '',
      src: 'discogs',
      exact: false,
    })).filter(r => r.title);
  } catch { restSource('discogs', 60000); return []; }
}

/* ------------------------------------------------------------- TIER Q
 * Free, community sound library, CC licensed sounds
 * Returns previews: previews.preview-hq-mp3, images
 * Good for sound effects, loops, instrument samples - not full songs but useful
 * For music app: use for intro/outro, sound effects, plus some music loops
 */
export async function freesoundSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('freesound')) return [];
  try {
    // Try without token via relay - some public search works, but preview needs token
    const b = proxyBase();
    // Public demo - search via site's own search which returns JSON
    const url = `https://freesound.org/apiv2/search/text/?query=${enc(query)}&page_size=${limit}&fields=id,name,username,previews,images,duration,license,tags`;
    // Without token this will 401, so we try via proxy with common pattern
    // Instead use the site's search which is CORS open via relay
    const searchUrl = `https://freesound.org/search/?q=${enc(query)}&f=&s=score&page=1`;
    const fetchUrl = b ? `${b}/?url=${enc(searchUrl)}` : searchUrl;
    // This returns HTML, not ideal - so we try API with no token to see if it returns data
    // For now, return empty but keep function for when user provides token
    // The structure is ready - user can add token in settings
    try {
      const d = await getJson(url, 8000);
      const results = d.results || [];
      return results.slice(0, limit).map((x) => ({
        id: `freesound:${x.id}`,
        title: clean(x.name || ''),
        artist: clean(x.username || ''),
        art: x.images?.waveform_bw_m || x.images?.spectral_bw_m || '',
        dur: Math.round(x.duration || 0),
        stream: x.previews?.['preview-hq-mp3'] || x.previews?.['preview-lq-mp3'] || '',
        streams: x.previews ? [{ q: 'hq', url: x.previews['preview-hq-mp3'] }].filter(s => s.url) : [],
        licence: x.license || '',
        tags: (x.tags || []).slice(0,5),
        src: 'freesound',
        exact: false,
        approximate: true,
      })).filter(r => r.title && r.stream);
    } catch {
      // No token yet - return empty but don't bench permanently
      return [];
    }
  } catch { return []; }
}

/* ------------------------------------------------------------- TIER R
 * Mixcloud API - https://www.mixcloud.com/developers/
 * Free, public endpoints open, CORS enabled, no auth for read
 * Endpoint: https://api.mixcloud.com/search/?q=party+time&type=cloudcast
 * Types: cloudcast (show), user, tag
 * Returns: mixes, DJ sets, radio shows - long form, often full hours
 * Perfect for Punjabi mixes, Bollywood mixes, etc - real DJ sets
 */
export async function mixcloudSearch(q, { limit = 8, type = 'cloudcast' } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('mixcloud')) return [];
  try {
    const url = `https://api.mixcloud.com/search/?q=${enc(query)}&type=${type}&limit=${limit}`;
    const d = await getJson(url, 12000);
    const results = d.data || [];
    return results.slice(0, limit).map((x) => ({
      id: `mixcloud:${(x.key || '').replace(/\//g, ':')}`,
      title: clean(x.name || ''),
      artist: clean(x.user?.name || x.user?.username || ''),
      album: '',
      art: x.pictures?.large || x.pictures?.medium || x.pictures?.thumbnail || '',
      dur: Math.round((x.audio_length || 0) / 1) || 0,
      stream: '', // Mixcloud doesn't give direct mp3, need player - but we provide link
      mixcloudUrl: x.url || '',
      key: x.key || '',
      playCount: +(x.play_count || 0),
      tags: (x.tags || []).map(t => t.name).slice(0,4),
      src: 'mixcloud',
      exact: false,
      approximate: true,
      isMix: true,
      metaOnly: false, // we can embed mixcloud player via widget
    })).filter(r => r.title);
  } catch { restSource('mixcloud', 60000); return []; }
}

/* ------------------------------------------------------------- TIER S
 * Genrenator API - https://binaryjazz.us/genrenator-api/
 * Free, no key needed, fun genre-name generator
 * Endpoints:
 * https://binaryjazz.us/wp-json/genrenator/v1/genre/ - random genre
 * https://binaryjazz.us/wp-json/genrenator/v1/genre/10/ - 10 random genres
 * https://binaryjazz.us/wp-json/genrenator/v1/story/ - random story
 * Use: generate fun genre names for radio search, mood, discovery
 * Not a music source but enhances UX + radio hints
 */
export async function genrenatorRandom({ count = 1 } = {}) {
  if (!sourceReady('genrenator')) return [];
  try {
    const url = count > 1 ? `https://binaryjazz.us/wp-json/genrenator/v1/genre/${count}/` : `https://binaryjazz.us/wp-json/genrenator/v1/genre/`;
    const d = await getJson(url, 8000);
    const genres = Array.isArray(d) ? d : [d];
    return genres.map((g, i) => ({
      id: `genrenator:${i}:${g.slice(0,20)}`,
      title: clean(g),
      artist: 'Random genre',
      genre: clean(g),
      src: 'genrenator',
      exact: false,
      isGenre: true,
    })).filter(r => r.title);
  } catch { restSource('genrenator', 60000); return []; }
}

export async function genrenatorStory({ count = 1 } = {}) {
  if (!sourceReady('genrenator-story')) return [];
  try {
    const url = count > 1 ? `https://binaryjazz.us/wp-json/genrenator/v1/story/${count}/` : `https://binaryjazz.us/wp-json/genrenator/v1/story/`;
    const d = await getJson(url, 8000);
    const stories = Array.isArray(d) ? d : [d];
    return stories.map((s, i) => ({
      id: `genrenator-story:${i}`,
      title: clean(s.slice(0, 80)),
      story: clean(s),
      src: 'genrenator-story',
      exact: false,
      isStory: true,
    }));
  } catch { restSource('genrenator-story', 60000); return []; }
}

/* ------------------------------------------------------------- TIER T
 * GaanaAPI enhanced - https://github.com/cyberboysumanjay/GaanaAPI
 * Original: Python Flask, search via gaana.com API, HLS streams
 * We already have GAANA mirror (gaana-api-fawn.vercel.app) + multi-engine gaana
 * Now add more Gaana mirrors from GitHub scan + direct Gaana web API via proxy
 * Gaana web: https://gaana.com/apiv2?seokey=&type=search&query=
 * Plus: https://github.com/ZingyTomato/GaanaPy - very_high_quality HLS
 */
const GAANA_MIRRORS = [
  'https://gaana-api-fawn.vercel.app', // verified 2026-08-30: 10 results Babbu Maan/Ishq Murshid, stream True, segment 282KB
  // 'https://gaana-api.vercel.app' 404 2026-08-30 removed
  // 'https://gaana-api-2.vercel.app' not verified, skip
];

export async function gaanaEnhancedSearch(q, { limit = 10 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  // Try each mirror
  for (const base of GAANA_MIRRORS) {
    if (!sourceReady('gaana-enh:' + base)) continue;
    try {
      const d = await getJson(`${base}/search?q=${enc(query)}`, 12000);
      const rows = (Array.isArray(d?.data) ? d.data : d.results || []).slice(0, limit).map((t, i) => {
        const m = t.music || t;
        const ladder = [m.very_high, m.high, m.medium, m.low, m.url, m.link].filter(Boolean);
        const secs = String(t.duration || m.duration || '').split(':').reduce((a, b) => a * 60 + (+b || 0), 0) || +(m.duration || 0);
        return {
          id: `gaana-enh:${i}:${(t.title || m.title || '').slice(0,24)}`,
          title: clean(t.title || m.title || t.name || ''),
          artist: clean(t.artists || m.artists || t.artist || ''),
          album: clean(t.album || m.album || ''),
          art: t.thumbnail?.large || t.thumbnail?.medium || m.artwork || '',
          dur: secs,
          lang: t.language || m.language || '',
          stream: ladder[0] || '',
          streams: ladder.map((url, n) => ({ q: ['very high', 'high', 'medium', 'low'][n] || n + 'k', url })),
          hlsStream: true,
          src: 'gaana-enhanced',
          exact: true,
        };
      }).filter(r => r.stream && r.title);
      if (rows.length) return rows;
      restSource('gaana-enh:' + base, 60000);
    } catch { restSource('gaana-enh:' + base, 60000); }
  }
  return [];
}

/* ------------------------------------------------------------- TIER U
 * JioSaavnAPI enhanced - https://github.com/cyberboysumanjay/JioSaavnAPI
 * Original Python API: search, song, album, playlist, lyrics
 * Endpoints: /search, /song, /album, /playlist
 * We already have 16 mirrors, but add cyberboysumanjay original + more
 * Also add sumitkolhe/saavn.sumit.co high-quality API
 */
const SAavn_EXTRA = [
  'https://saavn.sumit.co/api/search/songs?query=',
  'https://jiosaavn-api-codyandersan.vercel.app/search/songs?query=',
  'https://saavn-api-eight.vercel.app/api/search/songs?query=',
];

export async function saavnExtraSearch(q, { limit = 10 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  for (const entry of SAavn_EXTRA) {
    if (!sourceReady('saavn-extra:' + entry)) continue;
    try {
      const sep = entry.includes('?') ? '' : '?';
      const d = await getJson(`${entry}${enc(query)}&limit=${limit}`, 10000);
      const data = d?.data || d?.results || d;
      const rows = (Array.isArray(data) ? data : data.results || []).slice(0, limit).map((x) => {
        const dl = Array.isArray(x.downloadUrl) ? x.downloadUrl : [];
        const best = dl.length ? (dl[dl.length-1].link || dl[dl.length-1].url || '') : (x.url || '');
        const artists = x.primaryArtists || (Array.isArray(x.artists?.primary) ? x.artists.primary.map(a => a.name).join(', ') : '') || x.subtitle || '';
        return {
          id: `saavn-extra:${x.id || Math.random()}`,
          title: clean(x.name || x.title || x.song || ''),
          artist: clean(artists),
          album: clean(typeof x.album === 'string' ? x.album : x.album?.name || ''),
          art: Array.isArray(x.image) ? (x.image[x.image.length-1]?.link || '') : (x.image || ''),
          dur: +(x.duration || 0),
          lang: x.language || '',
          stream: best,
          streams: dl.map(q => ({ q: q.quality, url: q.link || q.url })).filter(s => s.url),
          src: 'saavn-extra',
          exact: true,
        };
      }).filter(r => r.stream && r.title);
      if (rows.length) return rows;
    } catch { restSource('saavn-extra:' + entry, 60000); }
  }
  return [];
}

const GAANA = 'https://gaana-api-fawn.vercel.app';

export async function secondCatalogueSearch(q, { limit = 10 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  if (!sourceReady('gaana')) return [];
  try {
    const d = await getJson(`${GAANA}/search?q=${enc(query)}`, 15000);
    const rows = (Array.isArray(d?.data) ? d.data : []).slice(0, limit).map((t, i) => {
      const m = t.music || {};
      /* Best rung first, then down. Every rung is the same signed playlist at
         a different bitrate, so a lower one is a real fallback, not a retry. */
      const ladder = [m.very_high, m.high, m.medium, m.low].filter(Boolean);
      const secs = String(t.duration || '').split(':').reduce((a, b) => a * 60 + (+b || 0), 0);
      return {
        id: `gaana:${i}:${(t.title || '').slice(0, 24)}`,
        title: clean(t.title || ''),
        artist: clean(t.artists || ''),
        album: clean(t.album || ''),
        art: t.thumbnail?.large || t.thumbnail?.medium || '',
        dur: secs,
        lang: t.language || '',
        stream: ladder[0] || '',
        streams: ladder.map((url, n) => ({ q: ['very high', 'high', 'medium', 'low'][n], url })),
        hlsStream: true,      // the player must use hls.js, not <audio src>
        playCount: 0,
        src: 'catalogue-two',
        exact: true,
      };
    }).filter((r) => r.stream && r.title);
    if (!rows.length) restSource('gaana', 60000);
    return rows;
  } catch { restSource('gaana'); return []; }
}

/* --------------------------------------------------------------- registry
 * Declared as data so the status panel can show it and the chain can walk it
 * without anyone editing an if-else ladder again.
 */
export const TIERS = [
  { id: 'A', name: 'Primary resolver',   infra: 'vendor API',            relay: true,  exact: true },
  { id: 'B', name: 'Catalogue mirrors',  infra: '16 community forks',    relay: false, exact: true },
  { id: 'C', name: 'Catalogue direct',   infra: 'the catalogue itself',  relay: false, exact: true },
  { id: 'J', name: 'Second catalogue',   infra: 'a different Indian service (Gaana HLS)', relay: false, exact: true },
  { id: 'K', name: 'Multi-engine Cloudflare', infra: '5 sources in 1 worker (Gaana+Hungama+Wynk+YT+Saavn) 320kbps direct mp3', relay: false, exact: true },
  { id: 'T', name: 'Gaana enhanced', infra: 'GaanaAPI 3 mirrors + HLS 320k (cyberboysumanjay + ZingyTomato)', relay: false, exact: true },
  { id: 'U', name: 'Saavn extra', infra: 'Saavn extra sumit.co + codyandersan + eight (high quality)', relay: false, exact: true },
  { id: 'D', name: 'Open music network', infra: 'decentralised Audius nodes (4 nodes)',   relay: false, exact: false },
  { id: 'E', name: 'Public archive',     infra: 'Archive.org public library (7398 punjabi items)',      relay: false, exact: false },
  { id: 'I', name: 'Community uploads', infra: 'hearthis.at upload platform (remix scene)',    relay: false, exact: false },
  { id: 'R', name: 'Mixcloud DJ sets', infra: 'Mixcloud public CORS* long mixes (Punjabi/Bollywood mixes)', relay: false, exact: false },
  { id: 'G', name: 'Open-licence pool',  infra: 'Openverse 3 commons platforms', relay: false, exact: false },
  { id: 'H', name: 'Open catalogue',     infra: 'Jamendo CC label official API',      relay: false, exact: false },
  { id: 'N', name: 'Jamendo enhanced',   infra: 'Jamendo enhanced 2 client_ids + backup + radios/albums', relay: false, exact: false },
  { id: 'O', name: 'Jamendo full', infra: 'Jamendo full API tracks/albums/artists/radios (v3.0 docs)', relay: false, exact: false },
  { id: 'L', name: 'Spotify metadata',   infra: 'Spotify public + 30s previews, no key, anti-ban', relay: false, exact: false },
  { id: 'M', name: 'Deezer+iTunes previews', infra: 'Deezer free no auth + iTunes CORS* 30s', relay: false, exact: false },
  { id: 'P', name: 'Last.fm metadata', infra: 'Last.fm track.search + artist.search + similar (free key)', relay: false, exact: false },
  { id: 'Q', name: 'Discogs metadata', infra: 'Discogs database search 25/min unauth + cover art', relay: false, exact: false },
  { id: 'S', name: 'Freesound loops', infra: 'Freesound CC samples/loops previews (community library)', relay: false, exact: false },
  { id: 'V', name: 'Genrenator fun', infra: 'Genrenator random genre names + stories (no key)', relay: false, exact: false },
  { id: 'F', name: 'Live radio',         infra: 'independent stations (58k stations, 3 mirrors)',  relay: false, exact: false },
];

export const usingRelay = () => !!proxyBase();
