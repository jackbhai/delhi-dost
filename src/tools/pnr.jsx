/**
 * PNR Status — 10-digit PNR par passenger-wise CNF / RAC / WL, chart state,
 * coach-berth aur journey details.
 *
 * The number is never stored or logged anywhere; every check is fresh. The
 * screen talks to a server relay (see api/pnr.mjs) which tries its configured
 * channels in order and returns ONE clean answer — so the app itself needs no
 * keys and no provider knowledge. When the relay is not deployed this screen
 * says so plainly and stays out of the way.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty } from '../ui/kit';
import { Icon } from '../ui/icons';
import { play as sound } from '../core/sfx.js';

const NUM = /^\d{10}$/;
const TONE = {
  ok: { cls: 'tone-ok', label: 'Confirmed', w: 'CNF' },
  wait: { cls: 'tone-wait', label: 'RAC', w: 'RAC' },
  muted: { cls: 'tone-muted', label: 'Waitlist', w: 'WL' },
  bad: { cls: 'tone-bad', label: 'Cancelled', w: 'CAN' },
  idle: { cls: 'tone-idle', label: 'Unknown', w: '?' },
};
function toneOf(st) {
  const s = String(st || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s === 'CNF' || s === 'CONFIRMED') return TONE.ok;
  if (s === 'RAC' || s.startsWith('RAC')) return TONE.wait;
  if (s === 'CAN' || s.startsWith('CANCEL')) return TONE.bad;
  if (s.includes('WL') || s.startsWith('PQ') || s.startsWith('RL') || s.startsWith('RE') || s === 'GNWL' || s === 'RLWL') return TONE.muted;
  return TONE.idle;
}

/* loose date — "Sep 4, 2026 4:40:00 AM" or "15-09-2026" or ISO */
function fmtDoj(v) {
  if (!v) return null;
  let d;
  if (/^\d{2}-\d{2}-\d{4}/.test(v)) {
    const [dd, mm, yyyy] = v.split(/[-\s/]/).slice(0, 3);
    d = new Date(+yyyy, +mm - 1, +dd);
  } else d = new Date(v);
  if (isNaN(d)) return String(v).slice(0, 11);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const fmtAt = (iso) => {
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};

function berthLine(x) {
  if (!x) return '—';
  const parts = [x.det || x.st, x.coach, x.berthNo != null ? x.berthNo : null, x.type].filter((v) => v != null && v !== '');
  return parts.join('/');
}
function improved(book, cur) {
  if (!book || !cur || !book.st || !cur.st) return false;
  const w = { CNF: 3, RAC: 2, WL: 1, CAN: 0 };
  const a = w[book.st] ?? 1, b = w[cur.st] ?? 1;
  return b > a;
}

function ToneChip({ st, big }) {
  const t = toneOf(st);
  return (
    <span className={`tone ${t.cls} ${big ? 'big' : ''}`}>
      <i />
      {st || '—'}
      <em>{t.label}</em>
    </span>);
}

/* -------------------------------------------------------- relay notes */
function RelayNote({ relay }) {
  if (relay !== 'none' && relay !== 'setup') return null;
  return (
    <Card style={{ borderColor: relay === 'setup' ? 'rgba(255,209,102,.4)' : 'rgba(255,93,115,.3)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ width: 34, height: 34, borderRadius: 11, flex: '0 0 auto', display: 'grid', placeItems: 'center',
          background: relay === 'setup' ? 'rgba(255,209,102,.12)' : 'rgba(255,93,115,.12)',
          color: relay === 'setup' ? 'var(--warn)' : 'var(--bad)', border: '1px solid var(--line)' }}>
          <Icon n="signal" size={17} />
        </span>
        <div style={{ fontSize: 12.8, lineHeight: 1.55 }}>
          <b style={{ display: 'block', fontSize: 13.4 }}>
            {relay === 'setup' ? 'Relay ready — keys abhi set nahi hui' : 'PNR checks is host pe abhi nahi hain'}
          </b>
          <span className="dim">
            {relay === 'setup'
              ? 'Server environment variables (RAILKIT_API_KEY / RAPIDAPI_KEY) set karo — README ka “PNR relay” section dekho.'
              : 'Ye page static host par hai; live PNR relay (Vercel function + keys) deploy hone ke baad yahan turant chalega. Setup steps README mein hain.'}
          </span>
        </div>
      </div>
    </Card>);
}

/* ----------------------------------------------------------- helpers */
function StatI({ l, v, ic, hue }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', textAlign: 'center', padding: '9px 4px' }}>
      <Icon n={ic} size={15} style={{ color: `var(${hue || '--cyan'})` }} />
      <b style={{ fontSize: 13, fontWeight: 750, letterSpacing: '-.1px', lineHeight: 1.15 }}>{v}</b>
      <span className="dim sm" style={{ fontSize: 9.6, textTransform: 'uppercase', letterSpacing: .7 }}>{l}</span>
    </div>);
}

/* --------------------------------------------------------------- tool */
export function PnrStatus() {
  const [pnr, setPnr] = useState('');
  const [relay, setRelay] = useState(null); // null | 'none' | 'setup'
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [viaFresh, setViaFresh] = useState(null);
  const [err, setErr] = useState('');
  const [checkedAt, setCheckedAt] = useState(null);
  const busyRef = useRef(false);

  /* Silent one-shot probe: is the relay reachable on this host at all? */
  useEffect(() => {
    let alive = true;
    fetch('/api/pnr?pnr=0000000000', { cache: 'no-store' })
      .then((res) => { if (alive && (res.status === 404 || res.status === 503)) setRelay(res.status === 503 ? 'setup' : 'none'); })
      .catch(() => { if (alive) setRelay('none'); });
    return () => { alive = false; };
  }, []);

  const can = NUM.test(pnr) && !busy;

  async function check() {
    if (!NUM.test(pnr) || busyRef.current) return;
    busyRef.current = true; setBusy(true); setErr('');
    sound('tick');
    try {
      const res = await fetch(`/api/pnr?pnr=${encodeURIComponent(pnr)}`, { cache: 'no-store' });
      if (res.status === 404 || res.status === 503) {
        setRelay(res.status === 503 ? 'setup' : 'none');
        setErr(res.status === 503
          ? 'Relay pe keys set nahi hain — environment variables ka setup karo.'
          : 'Live PNR relay is host pe deploy nahi hai.');
        sound('brake');
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !body.ok) {
        if (body && body.error === 'notfound') setErr('Ye PNR kisi active booking se match nahi karta — number check karo.');
        else if (body && body.error === 'upstream') setErr('Abhi rail enquiry systems se baat nahi ho payi. Thodi der baad try karo.');
        else setErr('Kuch gadbad hui — thodi der baad try karo.');
        sound('brake');
        return;
      }
      setData(body.data); setViaFresh(body.via || null);
      setCheckedAt(new Date().toISOString());
      setRelay(null);
      sound('chime');
    } catch {
      setErr('Network issue — thodi der baad try karo.');
      sound('brake');
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  const d = data;
  const j = d?.journey || {};
  const counts = useMemo(() => {
    const c = { ok: 0, wait: 0, muted: 0, bad: 0 };
    for (const p of d?.passengers || []) c[toneOf(p?.c?.st || p?.b?.st).cls === 'tone-ok' ? 'ok' : toneOf(p?.c?.st).cls === 'tone-wait' ? 'wait' : toneOf(p?.c?.st).cls === 'tone-bad' ? 'bad' : 'muted']++;
    return c;
  }, [d]);
  const chartT = d && (d.chart === 'prepared' ? { t: 'CHART PREPARED', tone: 'tone-ok' }
    : d.chart === 'cancelled' ? { t: 'TRAIN CANCELLED', tone: 'tone-bad' }
    : d.chart === 'not' ? { t: 'CHART NOT PREPARED', tone: 'tone-idle' }
    : { t: 'CHART STATUS —', tone: 'tone-idle' });

  return (
    <div style={{ paddingBottom: 26 }}>
      <RelayNote relay={relay} />

      <Card>
        <div className="chead"><Icon n="ticket" size={16} /> PNR number</div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4,
          background: 'var(--bg)', border: '1px solid var(--line2)', borderRadius: 16, padding: '6px 14px',
          boxShadow: 'inset 0 1px 6px rgba(0,0,0,.5)' }}>
          <Icon n="search" size={17} style={{ color: 'var(--fg3)', flex: '0 0 auto' }} />
          <input value={pnr} onChange={(e) => { setPnr(e.target.value.replace(/\D/g, '').slice(0, 10)); setData(null); setErr(''); }}
            inputMode="numeric" autoComplete="one-time-code" spellCheck={false} enterKeyHint="search"
            placeholder="e.g. 844 765 4321"
            aria-label="10-digit PNR number"
            onKeyDown={(e) => e.key === 'Enter' && can && check()}
            style={{ flex: 1, background: 'none', border: 0, outline: 'none', color: 'var(--fg)',
              fontFamily: 'var(--font-mono)', fontSize: 22, letterSpacing: 3, padding: '13px 2px', minWidth: 0 }} />
          <span className="dim sm" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, flex: '0 0 auto' }}>
            {pnr.length}<b>/10</b>
          </span>
        </div>
        <div className="dim sm" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon n="shield" size={13} style={{ color: 'var(--green)' }} />
          PNR yahan kabhi save nahi hota — har check fresh aur private.
        </div>
        <button className="btn" style={{ width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: relay === 'none' || relay === 'setup' || !NUM.test(pnr) ? .45 : 1 }}
          disabled={!can || relay === 'none' || relay === 'setup'} onClick={check}>
          {busy ? <><span className="spin" style={{ width: 16, height: 16, borderWidth: 2 }} /> Checking…</>
            : <><Icon n="signal" size={17} /> Check PNR status</>}
        </button>
      </Card>

      {err && !d && (
        <Card style={{ borderColor: 'rgba(255,93,115,.3)', marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon n="warn" size={18} style={{ color: 'var(--bad)', flex: '0 0 auto', marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13.4 }}>Check nahi hua</b>
              <p className="dim sm" style={{ marginTop: 3, lineHeight: 1.5 }}>{err}</p>
              {NUM.test(pnr) && relay !== 'setup' && relay !== 'none' && (
                <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => check()}>
                  <Icon n="refresh" size={14} /> Try again</button>)}
            </div>
          </div>
        </Card>)}

      {!d && !err && !busy && relay == null && (
        <div style={{ marginTop: 14 }}>
          <Empty t="PNR check karo"
            s="Booking wali ticket ke 10-digit PNR se — CNF / RAC / waitlist, coach-berth aur chart ki live halat." />
        </div>)}

      {d && chartT && (
        <>
          {/* ticket master */}
          <Card style={{ marginTop: 12, overflow: 'hidden', position: 'relative' }}>
            <div className={`tone ${chartT.tone}`} style={{ position: 'absolute', top: 13, right: 13, zIndex: 2 }}>
              <i />{chartT.t}
            </div>
            <div className="chead"><Icon n="train" size={16} /> Journey</div>
            <div style={{ marginTop: 4, paddingRight: 130 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 19, letterSpacing: '-.3px', fontFamily: 'var(--font-display)' }}>
                  {d.train.name || '—'}</b>
                <span className="tag" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, padding: '3px 9px', borderRadius: 8 }}>
                  {d.train.no || '—'}</span>
              </div>
              {j.doj && <div className="dim sm" style={{ marginTop: 4 }}>Journey · {fmtDoj(j.doj)}</div>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 6px', position: 'relative' }}>
              <div style={{ flex: '0 0 auto', textAlign: 'center', minWidth: 76 }}>
                <b style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 21, letterSpacing: 1.5 }}>{j.from?.code || '?'}</b>
                <span className="dim sm" style={{ display: 'block', maxWidth: 76 }}>{j.from?.name}</span>
              </div>
              <div style={{ flex: 1, position: 'relative', height: 26 }}>
                <div style={{ position: 'absolute', top: 12, left: 0, right: 0, height: 2,
                  background: 'repeating-linear-gradient(90deg, var(--fg3) 0 5px, transparent 5px 10px)', opacity: .5 }} />
                <span style={{ position: 'absolute', top: 2, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--s2)', border: '1px solid var(--line2)', borderRadius: 10, width: 34, height: 34,
                  display: 'grid', placeItems: 'center', color: 'var(--green)' }}><Icon n="train" size={17} /></span>
              </div>
              <div style={{ flex: '0 0 auto', textAlign: 'center', minWidth: 76 }}>
                <b style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 21, letterSpacing: 1.5 }}>{j.to?.code || '?'}</b>
                <span className="dim sm" style={{ display: 'block', maxWidth: 76 }}>{j.to?.name}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: '1px solid var(--line)', borderRadius: 15, marginTop: 10,
              background: 'color-mix(in srgb, var(--s2) 40%, transparent)' }}>
              <StatI ic="train" l="Class" v={j.cls || '—'} hue="--green" />
              <StatI ic="ticket" l="Quota" v={j.quota || '—'} hue="--cyan" />
              <StatI ic="pin" l="Boarding" v={j.boarding?.code || (j.from?.code) || '—'} hue="--warn" />
              <StatI ic="rupee" l="Fare ₹" v={d.fare != null ? d.fare : '—'} hue="--bad" />
            </div>
            {j.distKm ? <div className="dim sm" style={{ marginTop: 8 }}>{j.distKm} km · {j.arrive ? 'arr ' + fmtDoj(j.arrive) : ''}</div> : null}
          </Card>

          {/* passengers */}
          <Card style={{ marginTop: 12 }} pad={false}>
            <div className="chead" style={{ padding: '14px 15px 4px' }}>
              <Icon n="users" size={16} /> Passengers
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                {counts.ok > 0 && <span className="tag" style={{ color: '#2FE39B', borderColor: 'rgba(47,227,155,.35)', fontWeight: 750 }}>{counts.ok} CNF</span>}
                {counts.wait > 0 && <span className="tag w" style={{ fontWeight: 750 }}>{counts.wait} RAC</span>}
                {counts.muted > 0 && <span className="tag" style={{ fontWeight: 750 }}>{counts.muted} WL</span>}
                {counts.bad > 0 && <span className="tag" style={{ color: 'var(--bad)', borderColor: 'rgba(255,92,122,.35)', fontWeight: 750 }}>{counts.bad} CAN</span>}
              </span>
            </div>
            {(!d.passengers || d.passengers.length === 0) ? (
              <div className="dim sm" style={{ padding: '8px 15px 16px' }}>Passenger details is answer mein nahi mile.</div>
            ) : d.passengers.map((p) => {
              const cur = p.c || {}; const book = p.b || {};
              const isUp = improved(book, cur);
              const curT = toneOf(cur.st);
              return (
                <div key={p.s} style={{ borderTop: '1px solid var(--line)', padding: '12px 15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 10, flex: '0 0 auto', display: 'grid', placeItems: 'center',
                      background: 'var(--s2)', border: '1px solid var(--line)', fontFamily: 'var(--font-mono)', fontSize: 12.5,
                      color: 'var(--fg2)', fontWeight: 700 }}>P{p.s}</span>
                    <ToneChip st={cur.st || book.st} />
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <span className={`sm ${isUp ? '' : 'dim'}`} style={{ fontWeight: isUp ? 800 : 500, color: isUp ? '#2FE39B' : undefined }}>
                        {cur.coach || '—'}{cur.berthNo != null ? ` / ${cur.berthNo}` : ''}{cur.type ? ` / ${cur.type}` : ''}</span>
                      {isUp && <span className="tag" style={{ marginLeft: 6, color: '#2FE39B', borderColor: 'rgba(47,227,155,.4)' }}>
                        <Icon n="arrowu" size={10} style={{ color: 'inherit' }} /> upgraded</span>}
                    </div>
                  </div>
                  <div className="dim sm" style={{ marginTop: 7, display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--fg3)' }}>booked</span>
                    <span className="mono" style={{ fontSize: 11 }}>{berthLine(book)}</span>
                    <Icon n="right" size={12} style={{ color: 'var(--fg3)' }} />
                    <span style={{ color: 'var(--fg3)' }}>now</span>
                    <span className="mono" style={{ fontSize: 11 }}>{berthLine(cur)}</span>
                  </div>
                </div>);
            })}
            <div style={{ borderTop: '1px solid var(--line)', padding: '9px 15px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="dim sm">Checked {checkedAt ? fmtAt(checkedAt) : ''}</span>
              <span className="tag c"><Icon n="dot" size={10} /> fresh check</span>
              <button className="btn ghost sm" style={{ marginLeft: 'auto' }} disabled={busy || !NUM.test(pnr)}
                onClick={check}><Icon n="refresh" size={13} /> Refresh</button>
            </div>
          </Card>

          <div className="dim sm" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start', lineHeight: 1.5 }}>
            <Icon n="shield" size={13} style={{ color: 'var(--green)', flex: '0 0 auto', marginTop: 2 }} />
            Chart banne ke baad hi status final hota hai — booking ke time ki report prediction hai. Rail ticket hi authority hai.
          </div>
        </>)}
    </div>
  );
}
