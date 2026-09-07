/**
 * Real vector icons — no emoji anywhere in the UI.
 *
 * Every glyph is a hand-written 24x24 stroke path that inherits `currentColor`,
 * so icons pick up the theme (green / cyan / muted) automatically and stay
 * crisp on any DPI. Emoji were replaced because they render as a different
 * font on every OS, ignore our colour palette, and look like clip-art.
 */
import React from 'react';

const S = ({ children, size = 22, fill = 'none', sw = 1.7, style, className }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    className={'ico ' + (className || '')} style={style} aria-hidden="true" focusable="false">
    {children}
  </svg>
);

/* ---------------------------------------------------------------- weather */
export const Sun = (p) => <S {...p}><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" /></S>;
export const Cloud = (p) => <S {...p}><path d="M17.5 19a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.7 3.7 0 0 0 7 19z" /></S>;
export const Drop = (p) => <S {...p}><path d="M12 3.2s5.5 5.9 5.5 9.5a5.5 5.5 0 1 1-11 0C6.5 9.1 12 3.2 12 3.2z" /></S>;
export const Wind = (p) => <S {...p}><path d="M3 8h9.5a2.5 2.5 0 1 0-2.5-2.5M3 12h13a2.5 2.5 0 1 1-2.5 2.5M3 16h7.5a2 2 0 1 1-2 2" /></S>;

/* ------------------------------------------------------------------- time */
export const Clock = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.4 2" /></S>;
export const Calendar = (p) => <S {...p}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></S>;
export const Cake = (p) => <S {...p}><path d="M4 20h16M4 20v-5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5M12 9V6M9.5 6.5c0-1.4 2.5-3 2.5-3s2.5 1.6 2.5 3a2.5 2.5 0 0 1-5 0z" /></S>;
export const Timer = (p) => <S {...p}><circle cx="12" cy="13.5" r="7.5" /><path d="M12 10v3.6l2.4 1.6M9 2.5h6" /></S>;

/* ------------------------------------------------------------------ money */
export const Rupee = (p) => <S {...p}><path d="M7 4h10M7 9h10M16 4c0 3.4-2.4 5-6 5h-.7l7.7 10" /></S>;
export const Chart = (p) => <S {...p}><path d="M3 20h18M6 20v-6M11 20V8M16 20v-9M21 20V5" /></S>;
export const Coin = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M9.4 8.5h4.1a2 2 0 0 1 0 4H9.4m0 0h4.6M9.4 15.5h4.6M12 6.5v11" /></S>;
export const Swap = (p) => <S {...p}><path d="M4 8h13l-3.2-3.2M20 16H7l3.2 3.2" /></S>;
export const Percent = (p) => <S {...p}><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2.6" /><circle cx="16.5" cy="16.5" r="2.6" /></S>;
export const Home = (p) => <S {...p}><path d="M3.5 10.5 12 3.5l8.5 7M5.5 9.4V20h13V9.4M10 20v-5.5h4V20" /></S>;
export const Receipt = (p) => <S {...p}><path d="M5 3.5h14v17l-2.3-1.6-2.3 1.6-2.4-1.6-2.3 1.6L7.3 19 5 20.5zM9 8h6M9 12h6" /></S>;

/* --------------------------------------------------------------- transport */
export const Train = (p) => <S {...p}><rect x="5" y="3.5" width="14" height="12.5" rx="3" /><path d="M5 10h14M8.5 20.5 6.5 16M15.5 20.5l2-4.5M4 20.5h16" /><circle cx="9" cy="13" r=".9" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r=".9" fill="currentColor" stroke="none" /></S>;
export const Metro = (p) => <S {...p}><path d="M7.5 3.5h9a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3z" /><path d="M4.5 10h15M8 20.5l1.8-3.8M16 20.5l-1.8-3.8M5.5 20.5h13" /><circle cx="8.5" cy="13.2" r=".9" fill="currentColor" stroke="none" /><circle cx="15.5" cy="13.2" r=".9" fill="currentColor" stroke="none" /></S>;
export const Bus = (p) => <S {...p}><rect x="4" y="3.5" width="16" height="13.5" rx="2.5" /><path d="M4 11h16M7 17v2.2M17 17v2.2M4 7.5h16" /><circle cx="7.7" cy="14" r="1" fill="currentColor" stroke="none" /><circle cx="16.3" cy="14" r="1" fill="currentColor" stroke="none" /></S>;
export const Route = (p) => <S {...p}><circle cx="6" cy="6" r="2.6" /><circle cx="18" cy="18" r="2.6" /><path d="M8.6 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.4" /></S>;
export const Pin = (p) => <S {...p}><path d="M12 21.5s7-6.1 7-11.1a7 7 0 1 0-14 0c0 5 7 11.1 7 11.1z" /><circle cx="12" cy="10.2" r="2.7" /></S>;
export const Compass = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z" /></S>;
export const Luggage = (p) => <S {...p}><rect x="5" y="7.5" width="14" height="12.5" rx="2.5" /><path d="M9 7.5V5a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 5v2.5M10 11.5v5M14 11.5v5" /></S>;
export const Ticket = (p) => <S {...p}><path d="M4 8.5V6.2h16v2.3a2.6 2.6 0 0 0 0 5.2v4.3H4v-4.3a2.6 2.6 0 0 0 0-5.2z" /><path d="M13 6.2v11.8" strokeDasharray="2 2.4" /></S>;
export const Fare = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M9.2 8h5.6M9.2 11.4h5.6M14 8c0 2.6-1.8 3.8-4.6 3.8h-.2L14.8 17" /></S>;

/* ----------------------------------------------------------------- health */
export const Pill = (p) => <S {...p}><rect x="2.6" y="8.4" width="18.8" height="7.2" rx="3.6" transform="rotate(-45 12 12)" /><path d="M8.7 8.7l6.6 6.6" /></S>;
export const Heart = (p) => <S {...p}><path d="M12 20.3S3.8 15.1 3.8 9.4a4.6 4.6 0 0 1 8.2-2.8 4.6 4.6 0 0 1 8.2 2.8c0 5.7-8.2 10.9-8.2 10.9z" /></S>;
export const Shield = (p) => <S {...p}><path d="M12 21.4s7.2-3.3 7.2-9V5.6L12 2.6 4.8 5.6v6.8c0 5.7 7.2 9 7.2 9z" /><path d="m9.2 12 2 2 3.6-3.8" /></S>;
export const Warn = (p) => <S {...p}><path d="M12 3.7 21.2 20H2.8z" /><path d="M12 9.6v4.5M12 17.2v.1" /></S>;
export const Flask = (p) => <S {...p}><path d="M9.6 3v6.4L4.4 18a2 2 0 0 0 1.7 3h11.8a2 2 0 0 0 1.7-3l-5.2-8.6V3M8.4 3h7.2M7.2 14.2h9.6" /></S>;
export const Scale = (p) => <S {...p}><path d="M12 4v16M7 8h10M4 20h16M6.2 8 3.4 13.4a2.8 2.8 0 0 0 5.6 0zM17.8 8 15 13.4a2.8 2.8 0 0 0 5.6 0z" /></S>;

/* ------------------------------------------------------------------ media */
export const Music = (p) => <S {...p}><path d="M9 18V5.5l11-2v12" /><circle cx="6.3" cy="18" r="2.8" /><circle cx="17.3" cy="15.5" r="2.8" /></S>;
export const Play = (p) => <S {...p} fill="currentColor" sw={0}><path d="M7.5 4.8 19 12 7.5 19.2z" /></S>;
export const Pause = (p) => <S {...p} fill="currentColor" sw={0}><rect x="6.6" y="5" width="3.7" height="14" rx="1.2" /><rect x="13.7" y="5" width="3.7" height="14" rx="1.2" /></S>;
export const Next = (p) => <S {...p} fill="currentColor" sw={0}><path d="M5.5 5.4 15 12l-9.5 6.6z" /><rect x="16.4" y="5.4" width="2.6" height="13.2" rx="1.1" /></S>;
export const Prev = (p) => <S {...p} fill="currentColor" sw={0}><path d="M18.5 5.4 9 12l9.5 6.6z" /><rect x="5" y="5.4" width="2.6" height="13.2" rx="1.1" /></S>;
export const Radio = (p) => <S {...p}><rect x="2.8" y="8.6" width="18.4" height="11.6" rx="2.6" /><path d="m7 8.4 11-4.6" /><circle cx="16.4" cy="14.4" r="2.8" /><path d="M6 12.6h4.4M6 16.4h4.4" /></S>;
export const Disc = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.6" /></S>;
export const Film = (p) => <S {...p}><rect x="2.8" y="4.5" width="18.4" height="15" rx="2.4" /><path d="M7.4 4.5v15M16.6 4.5v15M2.8 12h18.4M2.8 8.2h4.6M2.8 15.8h4.6M16.6 8.2h4.6M16.6 15.8h4.6" /></S>;
export const News = (p) => <S {...p}><path d="M4 5.5h13v15H5.6A1.6 1.6 0 0 1 4 18.9zM17 9h3v9.5a2 2 0 0 1-4 0" /><path d="M7 9h7M7 12.5h7M7 16h4.5" /></S>;
export const Smile = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M8.4 14.2a4.4 4.4 0 0 0 7.2 0" /><circle cx="9.2" cy="9.8" r=".9" fill="currentColor" stroke="none" /><circle cx="14.8" cy="9.8" r=".9" fill="currentColor" stroke="none" /></S>;
export const Quote = (p) => <S {...p}><path d="M9.4 6.5c-3 1-4.6 3.3-4.6 6.6v4.4h5.4v-5.4H7.6c0-2 .6-3.2 2.5-4zM19.4 6.5c-3 1-4.6 3.3-4.6 6.6v4.4H20v-5.4h-2.4c0-2 .6-3.2 2.5-4z" /></S>;
export const Download = (p) => <S {...p}><path d="M12 3.5v11M7.6 10.4 12 14.8l4.4-4.4M4.5 19.5h15" /></S>;
export const Camera = (p) => <S {...p}><path d="M4 7.5h3.2l1.6-2.4h6.4l1.6 2.4H20a1.8 1.8 0 0 1 1.8 1.8v8.4A1.8 1.8 0 0 1 20 19.5H4a1.8 1.8 0 0 1-1.8-1.8V9.3A1.8 1.8 0 0 1 4 7.5z" /><circle cx="12" cy="13.2" r="3.4" /></S>;

/* ------------------------------------------------------------------ learn */
export const Book = (p) => <S {...p}><path d="M4 4.5h6a3 3 0 0 1 2 3v12a2.4 2.4 0 0 0-2-1.8H4zM20 4.5h-6a3 3 0 0 0-2 3v12a2.4 2.4 0 0 1 2-1.8h6z" /></S>;
export const Books = (p) => <S {...p}><path d="M4.4 5.2h3.4v14.6H4.4zM9 5.2h3.4v14.6H9zM14.2 6.2l3.2-.8 3 13.2-3.2.8z" /></S>;
export const Globe = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18A15 15 0 0 1 12 3z" /></S>;
export const Cap = (p) => <S {...p}><path d="m2.8 8.8 9.2-4.3 9.2 4.3-9.2 4.3z" /><path d="M6.6 10.6v5.2c0 1.6 2.4 3 5.4 3s5.4-1.4 5.4-3v-5.2M21.2 8.8v6" /></S>;
export const Search = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></S>;
export const Sparkle = (p) => <S {...p}><path d="M12 3.2 13.9 9l5.8 1.9-5.8 1.9-1.9 5.8-1.9-5.8L4.3 11 10.1 9z" /><path d="M18.6 3.4v3M17.1 4.9h3" /></S>;

/* ------------------------------------------------------------------ space */
export const Satellite = (p) => <S {...p}><path d="m8.6 8.6 6.8 6.8M6 6 3.4 8.6l3.4 3.4L9.4 9.4zM18 18l2.6-2.6-3.4-3.4-2.6 2.6z" /><path d="M14.4 4.6a5 5 0 0 1 5 5M13.6 8.6a2.4 2.4 0 0 1 1.8 1.8" /></S>;
export const Earth = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M3.6 9.2h4l2 2.8-1.6 3 1.6 3M20 8l-3.6 1.4-.6 3 3 1.4" /></S>;

/* -------------------------------------------------------------------- dev */
export const Code = (p) => <S {...p}><path d="m8.6 8-4.6 4 4.6 4M15.4 8l4.6 4-4.6 4M13.6 5l-3.2 14" /></S>;
export const Braces = (p) => <S {...p}><path d="M9 4.5c-2 0-2.6 1-2.6 2.6v2.3c0 1.4-.8 2.2-2.2 2.6 1.4.4 2.2 1.2 2.2 2.6v2.3c0 1.6.6 2.6 2.6 2.6M15 4.5c2 0 2.6 1 2.6 2.6v2.3c0 1.4.8 2.2 2.2 2.6-1.4.4-2.2 1.2-2.2 2.6v2.3c0 1.6-.6 2.6-2.6 2.6" /></S>;
export const Lock = (p) => <S {...p}><rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.4" /><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" /></S>;
export const Key = (p) => <S {...p}><circle cx="8" cy="15.8" r="4" /><path d="m10.9 13 8-8M17.2 6.8l2 2M15 9l2 2" /></S>;
export const Link = (p) => <S {...p}><path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.4 1.4M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.4-1.4" /></S>;
export const Hash = (p) => <S {...p}><path d="M4.8 9.4h14.4M4.2 14.6h14.4M10.4 4l-1.8 16M16 4l-1.8 16" /></S>;
export const Cog = (p) => <S {...p}><circle cx="12" cy="12" r="3.2" /><path d="M19.6 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1A1.6 1.6 0 0 0 10.4 4v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></S>;
export const Signal = (p) => <S {...p}><path d="M4.6 19.4a10.4 10.4 0 0 1 14.8 0M7.8 15.8a6 6 0 0 1 8.4 0" /><circle cx="12" cy="19.4" r="1.3" fill="currentColor" stroke="none" /></S>;
export const Badge = (p) => <S {...p}><circle cx="12" cy="9.4" r="5.6" /><path d="m8.4 14 -1 7.2 4.6-2.4 4.6 2.4-1-7.2" /></S>;

/* ------------------------------------------------------------------- text */
export const Type = (p) => <S {...p}><path d="M5 6.4V4.5h14v1.9M12 4.5v15M8.8 19.5h6.4" /></S>;
export const List = (p) => <S {...p}><path d="M9 6.4h11M9 12h11M9 17.6h11M4.4 6.4h.1M4.4 12h.1M4.4 17.6h.1" /></S>;
export const Doc = (p) => <S {...p}><path d="M13.4 3.2H7a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.8z" /><path d="M13.4 3.2v5.6H19M8.6 13h6.8M8.6 16.6h4.4" /></S>;
export const Numbers = (p) => <S {...p}><path d="M6.6 8 8.4 6.6v10.8M13 8.4a2.7 2.7 0 1 1 5 1.7l-5 7.3h5.4" /></S>;

/* --------------------------------------------------------------- generate */
export const Dice = (p) => <S {...p}><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4" /><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></S>;
export const Qr = (p) => <S {...p}><rect x="3.4" y="3.4" width="6.6" height="6.6" rx="1.4" /><rect x="14" y="3.4" width="6.6" height="6.6" rx="1.4" /><rect x="3.4" y="14" width="6.6" height="6.6" rx="1.4" /><path d="M14 14h3v3h-3zM20.6 14v3M17.6 20.6h3M14 20.6h.1" /></S>;
export const Id = (p) => <S {...p}><rect x="2.8" y="5" width="18.4" height="14" rx="2.6" /><circle cx="8.6" cy="11.2" r="2.2" /><path d="M5 16.4a3.8 3.8 0 0 1 7.2 0M14.6 10h4.2M14.6 13.4h4.2" /></S>;
export const Palette = (p) => <S {...p}><path d="M12 21a9 9 0 1 1 9-9c0 2.2-2 2.6-3.6 2.6h-1.6a2.2 2.2 0 0 0-1.4 3.9A2 2 0 0 1 12 21z" /><circle cx="7.6" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="9.8" cy="8" r="1.1" fill="currentColor" stroke="none" /><circle cx="14.4" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></S>;
export const Ruler = (p) => <S {...p}><rect x="1.6" y="8" width="20.8" height="8" rx="2" transform="rotate(-45 12 12)" /><path d="M8.4 7.2 10 8.8M11.2 10l1.6 1.6M14 12.8l1.6 1.6" /></S>;
export const Thermo = (p) => <S {...p}><path d="M14.4 14.2V5.6a2.4 2.4 0 0 0-4.8 0v8.6a4.4 4.4 0 1 0 4.8 0z" /><circle cx="12" cy="17.8" r="1.6" fill="currentColor" stroke="none" /></S>;
export const Image = (p) => <S {...p}><rect x="3" y="4.4" width="18" height="15.2" rx="2.6" /><circle cx="8.6" cy="9.6" r="1.8" /><path d="m3.6 17 4.8-4.4 3.6 3.2 3.4-3 4.6 4.2" /></S>;
export const Save = (p) => <S {...p}><path d="M5 3.6h11.4L20.4 7.6V19a1.4 1.4 0 0 1-1.4 1.4H5A1.4 1.4 0 0 1 3.6 19V5A1.4 1.4 0 0 1 5 3.6z" /><path d="M7.6 3.6v5.6h8V3.6M7.6 20.4v-6.2h8.8v6.2" /></S>;
export const Mail = (p) => <S {...p}><rect x="2.8" y="5" width="18.4" height="14" rx="2.4" /><path d="m3.6 6.6 8.4 6.2 8.4-6.2" /></S>;
export const Pen = (p) => <S {...p}><path d="m4 20 1-4.2L16.4 4.4a2.3 2.3 0 0 1 3.2 3.2L8.2 19zM14.6 6.2l3.2 3.2M3.6 21.6h16.8" /></S>;
export const Grid = (p) => <S {...p}><rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.8" /><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.8" /><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.8" /><rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.8" /></S>;
export const Star = (p) => <S {...p}><path d="m12 3.4 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.9l6.1-.9z" /></S>;
export const StarOn = (p) => <S {...p} fill="currentColor"><path d="m12 3.4 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.9l6.1-.9z" /></S>;
export const Wheat = (p) => <S {...p}><path d="M12 21V9.5M12 9.5c0-2.4 1.4-4.4 3.4-5.2.6 2.2 0 4.6-1.8 6-.5.4-1 .6-1.6.7zM12 9.5c0-2.4-1.4-4.4-3.4-5.2-.6 2.2 0 4.6 1.8 6 .5.4 1 .6 1.6.7zM12 15c0-2.3 1.4-4.2 3.4-5-.6 2.2 0 4.5-1.8 5.8-.5.4-1 .6-1.6.7zM12 15c0-2.3-1.4-4.2-3.4-5 .6 2.2 0 4.5 1.8 5.8.5.4 1 .6 1.6.7z" /></S>;
export const Mosque = (p) => <S {...p}><path d="M4 20.5h16M5.4 20.5v-7.2a6.6 6.6 0 0 1 13.2 0v7.2M12 6.7V4.4M9.2 20.5v-4a2.8 2.8 0 0 1 5.6 0v4" /></S>;
export const Info = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5M12 7.8v.1" /></S>;
export const Check = (p) => <S {...p}><path d="m4.8 12.6 4.8 4.8L19.2 7" /></S>;
export const X = (p) => <S {...p}><path d="M6 6 18 18M18 6 6 18" /></S>;
export const Chevron = (p) => <S {...p}><path d="m9 5.5 7 6.5-7 6.5" /></S>;
export const Back = (p) => <S {...p}><path d="M15 5.5 8 12l7 6.5" /></S>;
export const Refresh = (p) => <S {...p}><path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8M20.4 4v4.6h-4.6" /></S>;
export const Filter = (p) => <S {...p}><path d="M3.6 5.4h16.8l-6.6 7.8v5.6l-3.6 2v-7.6z" /></S>;
export const Bank = (p) => <S {...p}><path d="m3 9.4 9-5.4 9 5.4M4.6 9.4v9M9.4 9.4v9M14.6 9.4v9M19.4 9.4v9M2.8 21h18.4" /></S>;
export const Envelope = Mail;
export const Box = (p) => <S {...p}><path d="M12 2.8 21 7.4v9.2L12 21.2 3 16.6V7.4z" /><path d="M3 7.4 12 12l9-4.6M12 12v9.2" /></S>;

/* ------------------------------------------------------------ player extras
   Repeat-one needs its own glyph: reusing the plain refresh arrow for both
   "repeat all" and "repeat one" left the two states looking identical, so the
   only way to tell them apart was to remember how many times you had tapped. */
export const Repeat = (p) => <S {...p}><path d="M17 2.5 20.5 6 17 9.5" /><path d="M20.5 6H7a3.5 3.5 0 0 0-3.5 3.5V11" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M3.5 18H17a3.5 3.5 0 0 0 3.5-3.5V13" /></S>;
export const RepeatOne = (p) => <S {...p}><path d="M17 2.5 20.5 6 17 9.5" /><path d="M20.5 6H7a3.5 3.5 0 0 0-3.5 3.5V11" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M3.5 18H17a3.5 3.5 0 0 0 3.5-3.5V13" /><path d="M11 10.6l1.4-.9V15" strokeWidth="1.9" /></S>;
export const Shuffle = (p) => <S {...p}><path d="M17 3.5 20.5 7 17 10.5M17 13.5 20.5 17 17 20.5" /><path d="M3.5 7h3.2c1.3 0 2.5.7 3.2 1.8l3.6 6.4c.7 1.1 1.9 1.8 3.2 1.8h3.8" /><path d="M3.5 17h3.2c1.3 0 2.5-.7 3.2-1.8l.7-1.2M20.5 7h-3.8c-1.3 0-2.5.7-3.2 1.8l-.7 1.2" /></S>;
export const Volume = (p) => <S {...p}><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" /><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.5a7.8 7.8 0 0 1 0 11" /></S>;
export const VolumeOff = (p) => <S {...p}><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></S>;
export const Wave = (p) => <S {...p}><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21.5 12h.5" /></S>;
export const Bolt = (p) => <S {...p}><path d="M13.2 2.5 4.5 13.4h6L9.8 21.5l9-11.2h-6.2z" /></S>;
export const Moon = (p) => <S {...p}><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.7 8.7 0 1 0 11.1 11.1z" /></S>;
export const Cast = (p) => <S {...p}><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14" /><path d="M3 20a1 1 0 0 0 0-2M3 16.5a4.5 4.5 0 0 1 4.5 4.5M3 12.5A8.5 8.5 0 0 1 11.5 21" /></S>;
export const Expand = (p) => <S {...p}><path d="M4 9V4.5h5M20 9V4.5h-5M4 15v4.5h5M20 15v4.5h-5" /></S>;
export const Max = Expand;
export const Min = (p) => <S {...p}><path d="M9 4.5H4.5v5M15 4.5h4.5v5M9 19.5H4.5v-5M15 19.5h4.5v-5" /></S>;
export const Down = (p) => <S {...p}><path d="m5 9 7 7 7-7" /></S>;
export const Up = (p) => <S {...p}><path d="m5 15 7-7 7 7" /></S>;
export const Plus = (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const Trash = (p) => <S {...p}><path d="M4 6.5h16M9.5 6.5V4.2h5v2.3M6.5 6.5l.9 13a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-13" /><path d="M10.5 10.5v6.5M13.5 10.5v6.5" /></S>;
export const Queue = (p) => <S {...p}><path d="M3 6h11M3 11h11M3 16h7" /><path d="M17.5 20V11.5l4-1.2V19" /><circle cx="16" cy="20" r="1.6" /><circle cx="20" cy="18.8" r="1.6" /></S>;
export const Mic = (p) => <S {...p}><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" /></S>;

/* ------------------------------------------------------------- travel / trips */
export const MapIcon = (p) => <S {...p}><path d="M9.2 4 3.4 6.3v13.4L9.2 17.4l5.6 2.6 5.8-2.3V4.3l-5.8 2.3L9.2 4z" /><path d="M9.2 4v13.4M14.8 6.6V20" /></S>;
export const Bell = (p) => <S {...p}><path d="M6.4 16.2v-4.6a5.6 5.6 0 0 1 11.2 0v4.6l1.6 2.4H4.8l1.6-2.4z" /><path d="M10.2 21a1.9 1.9 0 0 0 3.6 0" /></S>;
export const Flag = (p) => <S {...p}><path d="M6.4 20.4V4.2h10.8l-1.9 3.6 1.9 3.6H6.4" /></S>;
export const Walk = (p) => <S {...p}><circle cx="13.4" cy="4.4" r="1.5" /><path d="M12.6 8 9.8 9.9l-.8 3.3M12.6 8l1.3 4-1.4 3.7-2.8 4.2M13.9 12l2.6 1.4.8 4.7M9.8 9.9 6.6 12.4" /></S>;
export const Navigation = (p) => <S {...p}><path d="M12 3.2 19.6 20.4 12 16.6l-7.6 3.8L12 3.2z" /></S>;
export const BellOff = (p) => <S {...p}><path d="M6.4 16.2v-4.6a5.6 5.6 0 0 1 8.2-5M17.6 11.6v-0.1M17.6 11.6v4.6l1.6 2.4H7.2M4.8 18.6l1.6-2.4M3 3l18 18" /></S>;

/** Registry so tools can be declared with a plain string name. */
export const ICONS = {
  sun: Sun, cloud: Cloud, drop: Drop, wind: Wind,
  clock: Clock, calendar: Calendar, cake: Cake, timer: Timer,
  rupee: Rupee, chart: Chart, coin: Coin, swap: Swap, percent: Percent, home: Home, receipt: Receipt,
  train: Train, metro: Metro, bus: Bus, route: Route, pin: Pin, compass: Compass,
  luggage: Luggage, ticket: Ticket, fare: Fare,
  pill: Pill, heart: Heart, shield: Shield, warn: Warn, flask: Flask, scale: Scale,
  music: Music, play: Play, pause: Pause, next: Next, prev: Prev, radio: Radio, disc: Disc,
  film: Film, news: News, smile: Smile, quote: Quote, download: Download, camera: Camera,
  book: Book, books: Books, globe: Globe, cap: Cap, search: Search, sparkle: Sparkle,
  satellite: Satellite, earth: Earth,
  code: Code, braces: Braces, lock: Lock, key: Key, link: Link, hash: Hash, cog: Cog,
  signal: Signal, badge: Badge,
  type: Type, list: List, doc: Doc, numbers: Numbers,
  dice: Dice, qr: Qr, id: Id, palette: Palette, ruler: Ruler, thermo: Thermo,
  image: Image, save: Save, mail: Mail, pen: Pen, grid: Grid, star: Star, staron: StarOn,
  wheat: Wheat, mosque: Mosque, info: Info, check: Check, x: X, chevron: Chevron,
  back: Back, refresh: Refresh, filter: Filter, bank: Bank, box: Box,
  repeat: Repeat, repeatone: RepeatOne, shuffle: Shuffle,
  volume: Volume, volumeoff: VolumeOff, wave: Wave, bolt: Bolt, moon: Moon,
  cast: Cast, expand: Expand, max: Max, min: Min, down: Down, up: Up, plus: Plus, trash: Trash, queue: Queue, mic: Mic,
  map: MapIcon, bell: Bell, bellof: BellOff, flag: Flag, walk: Walk, navigation: Navigation,
};

/** <Icon n="bus" size={22} /> */
export function Icon({ n, ...rest }) {
  const C = ICONS[n] || Box;
  return <C {...rest} />;
}
export default Icon;
