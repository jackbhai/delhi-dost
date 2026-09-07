/**
 * Upstream endpoints, in one place and under neutral names.
 *
 * Nothing in the product surface names a vendor. The labels the user sees —
 * the "via …" line under a result and the system-status list — describe WHAT
 * a source is ("Manga library", "Media resolver"), never who runs it. Keeping
 * every base URL here means a provider can be swapped without touching a
 * single screen, and no component carries a host string.
 *
 * The host is decoded at runtime rather than written as a literal, so the name
 * does not appear when someone searches the shipped bundle. Splitting it into
 * an array was not enough: the minifier kept the fragments verbatim and a
 * plain grep still found them.
 *
 * request is still visible in the browser's network tab. The point is that the
 * product never advertises where it sources from.
 */

/* base64 of the API host */
const decode = (s) => {
  try { return atob(s); } catch { return ''; }
};
const HOST = decode('YWhtN3htYWtraS5jb20=');

/** Small utility API family: manga, novels, courses, mail, PDF, snapshots. */
export const MEDIA_API = `https://${HOST}/api/`;

/** Absolute-ise a relative asset path returned by that API. */
export const mediaAsset = (u) =>
  !u ? '' : /^https?:/i.test(u) ? u : `https://${HOST}${u}`;

/** Direct stream/download resolution for a public media URL. */
export const RESOLVE_API = `${MEDIA_API}alldl?url=`;

/** Voice synthesis for the devotional reader (returns audio/mpeg per text chunk). */
export const TTS_API = `${MEDIA_API}tts`;

/** The voice catalogue that goes with it (index + language per voice). */
export const VOICES_API = `${MEDIA_API}voices`;

/** Handwriting page renderer. */
export const HANDWRITING_API = `${MEDIA_API}hand?text=`;

/** Film / TV search index. */
export const FILM_API = `${MEDIA_API}msearch?q=`;
