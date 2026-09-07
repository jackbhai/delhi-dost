import React, { useCallback, useEffect, useRef, useState } from 'react';
import { resolve } from '../core/engine';
import { Icon } from './icons';

/* ---------------------------------------------------------- data hook */
export function useData(cap, pool, params, { auto = true, ttl, deps = [], spread = true } = {}) {
  const [s, set] = useState({ loading: auto, data: null, error: null, meta: null });
  const argRef = useRef({ cap, pool, params, ttl, spread });
  argRef.current = { cap, pool, params, ttl, spread };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /* React StrictMode intentionally mounts → unmounts → remounts in dev.
     Any "ignore stale response" guard keyed on a counter ends up throwing away
     the only real response. We instead key on the request signature: a response
     is applied when it matches whatever the component last asked for. */
  const wantRef = useRef('');

  const run = useCallback(async (override) => {
    const { cap: c, pool: pl, params: pr, ttl: t, spread: sp } = argRef.current;
    const req = override ?? pr;
    const sig = c + ':' + JSON.stringify(req);
    wantRef.current = sig;
    set((p) => ({ ...p, loading: true, error: null }));
    try {
      const r = await resolve(c, pl, req, { ttl: t, spread: sp });
      if (wantRef.current === sig) set({ loading: false, data: r.data, error: null, meta: r });
    } catch (e) {
      if (wantRef.current === sig) set({ loading: false, data: null, error: e, meta: null });
    }
  }, []);

  useEffect(() => { if (auto) run(); }, deps);   // eslint-disable-line
  return { ...s, run };
}

export function useDebounced(v, ms = 420) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/* ---------------------------------------------------------- states */
export const Spin = ({ t = 'Loading' }) => (
  <div className="state"><div className="spin" /><span>{t}…</span></div>
);

export const Empty = ({ t = 'No results' }) => <div className="state"><span>{t}</span></div>;

export function Err({ error, retry }) {
  const a = error?.attempts || [];
  return (
    <div className="err">
      <h4>Couldn't load</h4>
      <p>All backup sources were unreachable. Your connection may be offline.</p>
      {a.length > 0 && (
        <details>
          <summary>Tried {a.length} source{a.length > 1 ? 's' : ''}</summary>
          <ul>{a.map((x, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon n={x.ok ? 'check' : 'x'} size={13}
                style={{ color: x.ok ? 'var(--green)' : 'var(--bad)' }} />
              {x.label} · {x.ms}ms {x.error ? `— ${x.error}` : ''}</li>
          ))}</ul>
        </details>
      )}
      {retry && <button className="btn sm" style={{ marginTop: 10 }} onClick={retry}>Retry</button>}
    </div>
  );
}

/** Provenance line — which of the pooled sources actually answered. */
export function Src({ meta }) {
  if (!meta) return null;
  const failed = (meta.attempts || []).filter((a) => !a.ok).length;
  return (
    <div className="src">
      <span className={`dot ${meta.stale ? 'warn' : ''}`} />
      <span>via <b style={{ color: 'var(--fg2)' }}>{meta.label}</b></span>
      {meta.cached && !meta.stale && <span className="tag">cached</span>}
      {meta.stale && <span className="tag w">offline copy · {meta.ageMin}m old</span>}
      {failed > 0 && <span className="tag c">failover ×{failed}</span>}
    </div>
  );
}

/* ---------------------------------------------------------- inputs */
export function Search({ value, onChange, onSubmit, ph, auto }) {
  return (
    <form className="search" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); e.target.querySelector('input')?.blur(); }}>
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph}
        autoFocus={auto} enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck="false" />
      {value && <button type="button" onClick={() => onChange('')}
        style={{ background: 'none', border: 0, color: 'var(--fg3)', fontSize: 20, cursor: 'pointer' }}>×</button>}
    </form>
  );
}

export const Field = ({ label, as = 'input', ...p }) => {
  const C = as;
  return <div className="fld"><label>{label}</label><C {...p} /></div>;
};

export const Stat = ({ l, v, s }) => (
  <div className="stat"><div className="v">{v}</div><div className="l">{l}</div>{s && <div className="s">{s}</div>}</div>
);

export const Card = ({ children, ...p }) => <div className="card" {...p}>{children}</div>;

export const Chips = ({ items, value, onPick }) => (
  <div className="btnrow">
    {items.map((x) => {
      const val = typeof x === 'string' ? x : x.v;
      const lab = typeof x === 'string' ? x : x.l;
      return <button key={val} className={`cat ${value === val ? 'on' : ''}`} onClick={() => onPick(val)}>{lab}</button>;
    })}
  </div>
);

export function Copy({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn ghost sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      setDone(true); setTimeout(() => setDone(false), 1400);
      navigator.vibrate?.(12);
    }}>{done ? '✓ Copied' : label}</button>
  );
}

export const fmt = (n, d = 0) =>
  n == null || Number.isNaN(+n) ? '—' : (+n).toLocaleString('en-IN', { maximumFractionDigits: d });

/**
 * WMO weather codes -> [label, icon name].
 *
 * These used to hold emoji. An emoji is a different font on every device,
 * so the forecast row looked different on each phone and could not take the
 * theme colour. The second element is now a key into src/ui/icons.jsx and is
 * rendered with <Icon n={...} />.
 */
export const WMO = {
  0:  ['Clear', 'sun'],           1:  ['Mainly clear', 'sun'],
  2:  ['Partly cloudy', 'cloud'], 3:  ['Overcast', 'cloud'],
  45: ['Fog', 'cloud'],           48: ['Rime fog', 'cloud'],
  51: ['Light drizzle', 'drop'],  53: ['Drizzle', 'drop'],
  55: ['Heavy drizzle', 'drop'],  61: ['Light rain', 'drop'],
  63: ['Rain', 'drop'],           65: ['Heavy rain', 'drop'],
  71: ['Light snow', 'drop'],     73: ['Snow', 'drop'],
  75: ['Heavy snow', 'drop'],     80: ['Showers', 'drop'],
  81: ['Showers', 'drop'],        82: ['Violent showers', 'drop'],
  95: ['Thunderstorm', 'wind'],   96: ['Storm', 'wind'],
  99: ['Severe storm', 'wind'],
};
export const wmo = (c) => WMO[c] || ['—', 'thermo'];
