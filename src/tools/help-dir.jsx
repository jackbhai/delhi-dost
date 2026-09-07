/**
 * Emergency Call & WhatsApp directory — Delhi-first, India-wide.
 *
 * One tap on a number calls it (tel:); numbers that are real mobile lines get
 * a WhatsApp button (wa.me) with a ready-made message. Works fully offline —
 * the directory is bundled, no network needed.
 *
 * Every entry was cross-checked against official/current public listings at
 * build time. Government numbers can change; a one-line disclaimer below the
 * list says so, and the entries are easy to edit in the DATA block.
 */
import React, { useMemo, useState } from 'react';
import { Icon } from '../ui/icons';
import { Card } from '../ui/kit';

const WA_TEXT = (service) =>
  encodeURIComponent(`Namaste, main Delhi DOST app se baat kar raha/rahi hoon. Mujhe ${service} se madad chahiye.`);

/* ------------------------------------------------------------------ DATA
   kind: 'short' = 3-4 digit helpline (tel only, no SMS/WhatsApp)
         'mobile' = 10-digit mobile (gets Call + WhatsApp)
         'land'   = landline / toll-free (Call + copy)                          */
const GROUPS = [
  {
    id: 'police', name: 'Police & Safety', icon: 'shield',
    items: [
      { n: 'Police — PCR', note: 'Crime, emergency, any police help', nums: [{ v: '100', kind: 'short' }] },
      { n: 'Fire Brigade', note: 'Fire / rescue', nums: [{ v: '101', kind: 'short' }] },
      { n: 'National Emergency', note: 'Police + fire + ambulance, one number', nums: [{ v: '112', kind: 'short' }] },
      { n: 'Delhi Traffic Police', note: 'Traffic jam, accident, violation', nums: [{ v: '1095', kind: 'short' }, { v: '011-25844444', kind: 'land' }] },
      { n: 'Missing Person (Delhi Police)', note: '', nums: [{ v: '1094', kind: 'short' }] },
      { n: 'Anti-Corruption / Vigilance (Delhi Police)', note: '', nums: [{ v: '1064', kind: 'short' }] },
      { n: 'Eyes & Ears (Delhi Police)', note: 'Anonymous tip-off line', nums: [{ v: '14547', kind: 'short' }] },
      { n: 'Railway Police', note: 'Theft / trouble on trains or platforms', nums: [{ v: '1512', kind: 'short' }] },
    ],
  },
  {
    id: 'women', name: 'Women & Child', icon: 'heart',
    items: [
      { n: 'Women in Distress', note: 'Delhi Police women helpline', nums: [{ v: '1091', kind: 'short' }] },
      { n: 'Domestic Abuse', note: 'National women helpline', nums: [{ v: '181', kind: 'short' }] },
      { n: 'Child Helpline', note: 'CHILDLINE India', nums: [{ v: '1098', kind: 'short' }] },
      { n: 'Senior Citizens', note: 'Delhi Police — senior citizen helpline', nums: [{ v: '1291', kind: 'short' }] },
      { n: 'Elder Line', note: 'National helpline for elders', nums: [{ v: '14567', kind: 'short' }] },
    ],
  },
  {
    id: 'metro', name: 'Metro', icon: 'metro',
    items: [
      { n: 'DMRC Helpline', note: '24×7 — complaints, queries, lost items', nums: [{ v: '155370', kind: 'short' }, { v: '011-22561231', kind: 'land' }] },
      { n: 'DMRC (Alternate)', note: 'Corporate office switchboard', nums: [{ v: '011-23417921', kind: 'land' }] },
    ],
  },
  {
    id: 'bus', name: 'Bus (DTC / Cluster)', icon: 'bus',
    items: [
      { n: 'DTC Helpline', note: 'Toll-free — info & complaints', nums: [{ v: '1800-11-8181', kind: 'land' }] },
      { n: 'DTC Customer Care', note: 'Complaints / suggestions', nums: [{ v: '011-41400400', kind: 'land' }] },
      { n: 'DTC Central Control Room', note: '24×7 — route & service info', nums: [{ v: '011-23370209', kind: 'land' }, { v: '011-23370210', kind: 'land' }] },
      { n: 'DTC Control (Mobile)', note: 'WhatsApp bhi kar sakte hain', nums: [{ v: '8744073229', kind: 'mobile' }] },
      { n: 'DTC Lost Property', note: 'Scindia House — items left on buses', nums: [{ v: '011-23752769', kind: 'land' }] },
    ],
  },
  {
    id: 'rail', name: 'Train / Rail', icon: 'train',
    items: [
      { n: 'Railway Helpline', note: 'Indian Railways — ticket, train info, help', nums: [{ v: '139', kind: 'short' }] },
      { n: 'Rail Madad', note: 'Complaints on train / station (also app + web)', nums: [{ v: '139', kind: 'short' }] },
      { n: 'Railway Police', note: 'RPF security helpline', nums: [{ v: '1512', kind: 'short' }] },
    ],
  },
  {
    id: 'medical', name: 'Medical & Ambulance', icon: 'heart',
    items: [
      { n: 'Ambulance (CATS Delhi)', note: 'Govt ambulance — Delhi', nums: [{ v: '102', kind: 'short' }] },
      { n: 'Accident & Trauma (CATS)', note: 'Road accidents / trauma response', nums: [{ v: '1099', kind: 'short' }] },
      { n: 'AIIMS New Delhi', note: 'Main hospital board / emergency', nums: [{ v: '011-26588500', kind: 'land' }] },
      { n: 'Anti-Poison (New Delhi)', note: 'Poisoning / overdose guidance', nums: [{ v: '1066', kind: 'short' }] },
      { n: 'Tele-MANAS', note: 'Free mental health helpline (Govt of India)', nums: [{ v: '14416', kind: 'short' }, { v: '1800-891-4416', kind: 'land' }] },
      { n: 'KIRAN', note: 'Mental health rehabilitation (MHA)', nums: [{ v: '1800-599-0019', kind: 'land' }] },
      { n: 'iCall (TISS)', note: 'Mental health counselling (Mon–Sat)', nums: [{ v: '9152987821', kind: 'mobile' }] },
      { n: 'Aasra', note: '24×7 suicide prevention / distress', nums: [{ v: '9820466726', kind: 'mobile' }] },
      { n: 'Vandrevala Foundation', note: 'Mental health support', nums: [{ v: '1860-2662-345', kind: 'land' }] },
      { n: 'AIDS Helpline', note: '', nums: [{ v: '1097', kind: 'short' }] },
    ],
  },
  {
    id: 'utility', name: 'Govt & Utility', icon: 'cog',
    items: [
      { n: 'Disaster Management (Delhi)', note: 'Flood, storm, heat — NCT control', nums: [{ v: '1077', kind: 'short' }] },
      { n: 'NDMA', note: 'National Disaster Management', nums: [{ v: '1078', kind: 'short' }] },
      { n: 'Cyber Crime', note: 'Online fraud / cyber complaint', nums: [{ v: '1930', kind: 'short' }] },
      { n: 'Tourist Helpline', note: 'Multi-language, all India', nums: [{ v: '1363', kind: 'short' }] },
      { n: 'Highway Helpline', note: 'Road emergency — NHs', nums: [{ v: '1033', kind: 'short' }] },
      { n: 'Gas Leak / LPG Emergency', note: '', nums: [{ v: '1906', kind: 'short' }] },
      { n: 'Electricity (Delhi)', note: 'Power cut / fault — all Delhi discoms', nums: [{ v: '19124', kind: 'short' }] },
      { n: 'Water (DJB)', note: 'Delhi Jal Board — leak, supply', nums: [{ v: '1916', kind: 'short' }] },
      { n: 'EPFO', note: 'PF / pension help', nums: [{ v: '14470', kind: 'short' }] },
      { n: 'Aadhaar Helpline', note: 'UIDAI', nums: [{ v: '1947', kind: 'short' }] },
    ],
  },
];

const QUICK = [
  { v: '112', n: 'Emergency', note: 'Police+Fire+Ambulance', c: '#FF5D73' },
  { v: '100', n: 'Police', note: 'PCR', c: '#4C9AFF' },
  { v: '102', n: 'Ambulance', note: 'CATS Delhi', c: '#22C55E' },
  { v: '101', n: 'Fire', note: '', c: '#FF8A3D' },
  { v: '155370', n: 'DMRC', note: 'Metro', c: '#A78BFA' },
  { v: '139', n: 'Railways', note: '', c: '#2DD4BF' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (x) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));

export function EmergencyDirectory() {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState('');

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return GROUPS.map((g) => {
      const items = g.items.filter((it) => {
        const matchCat = cat === 'all' || g.id === cat;
        if (!matchCat) return false;
        if (!s) return true;
        const hay = (it.n + ' ' + it.note + ' ' + it.nums.map((x) => x.v).join(' ')).toLowerCase();
        return hay.includes(s);
      });
      return { ...g, items };
    }).filter((g) => g.items.length);
  }, [cat, q]);

  const allCount = GROUPS.reduce((a, g) => a + g.items.length, 0);

  const copy = async (v) => {
    try { await navigator.clipboard.writeText(v.replace(/[^0-9+]/g, '')); setCopied(v); setTimeout(() => setCopied(''), 1400); } catch { /* noop */ }
  };

  return (
    <div style={{ paddingBottom: 26 }}>
      {/* quick dial */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 9 }}>
        {QUICK.map((qk) => (
          <a key={qk.v + qk.n} href={`tel:${qk.v}`} className="qcall"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '12px 6px', borderRadius: 16, textDecoration: 'none',
              background: `linear-gradient(160deg, ${qk.c}33, transparent 70%), var(--s1)`,
              border: `1px solid ${qk.c}55`, color: 'var(--fg)',
            }}>
            <b style={{ fontSize: 21, color: qk.c, letterSpacing: .5 }}>{qk.v}</b>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>{qk.n}</span>
            {qk.note && <span className="dim" style={{ fontSize: 9.5 }}>{qk.note}</span>}
          </a>
        ))}
      </div>

      {/* search */}
      <div className="search" style={{ marginTop: 14 }}>
        <Icon n="search" size={17} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${allCount} numbers… (“metro”, “women”, “gas”)`} style={{ padding: '13px 0' }} />
        {q && <button className="iconbtn" onClick={() => setQ('')} aria-label="Clear" style={{ width: 30, height: 30, border: 0, background: 'none' }}><Icon n="x" size={15} /></button>}
      </div>

      {/* category chips */}
      <div className="cats" style={{ paddingBottom: 10 }}>
        <button className={`cat ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>All</button>
        {GROUPS.map((g) => (
          <button key={g.id} className={`cat ${cat === g.id ? 'on' : ''}`} onClick={() => setCat(g.id)}>
            {g.name}
          </button>))}
      </div>

      {shown.length === 0 && <div className="state"><Icon n="search" size={26} /><p>Koi number nahi mila — search badal kar dekhein</p></div>}

      {shown.map((g) => (
        <div key={g.id} style={{ marginTop: 6 }}>
          <div className="chead" style={{ margin: '14px 0 8px' }}>
            <Icon n={g.icon} size={15} /> {g.name}
          </div>
          <Card pad={false} style={{ overflow: 'hidden' }}>
            {g.items.map((it, idx) => (
              <div key={it.n} style={{
                padding: '11px 14px', borderTop: idx ? '1px solid var(--line)' : 0,
                background: idx % 2 ? 'var(--s1)' : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b style={{ fontSize: 13.5, display: 'block' }}>{it.n}</b>
                    {it.note && <span className="dim" style={{ fontSize: 10.5 }}>{it.note}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {it.nums.slice(0, 2).map((num) => (
                      <React.Fragment key={num.v}>
                        <a href={`tel:${num.v.replace(/[^0-9+]/g, '')}`} title={`Call ${num.v}`} aria-label={`Call ${it.n} ${num.v}`}
                          style={{
                            width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center',
                            background: 'var(--green)', color: '#101010', boxShadow: '0 6px 14px -8px rgba(255,176,32,.8)',
                          }}>
                          <Icon n="phone" size={17} />
                        </a>
                        {num.kind === 'mobile' && (
                          <a href={`https://wa.me/91${num.v.replace(/\D/g, '')}?text=${WA_TEXT(it.n)}`} target="_blank" rel="noreferrer"
                            title={`WhatsApp ${num.v}`} aria-label={`WhatsApp ${it.n}`}
                            style={{
                              width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center',
                              background: '#25D366', color: '#06281a', boxShadow: '0 6px 14px -8px rgba(37,211,102,.9)',
                            }}>
                            <Icon n="wa" size={19} />
                          </a>)}
                        <button className="iconbtn" onClick={() => copy(num.v)} aria-label={`Copy ${num.v}`}
                          style={{ width: 34, height: 34, borderRadius: 10 }}>
                          {copied === num.v ? <span style={{ color: 'var(--green)', fontWeight: 800 }}>✓</span>
                            : <Icon n="copy" size={14} />}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                {it.nums.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                    {it.nums.map((num, i) => (
                      <span key={num.v + i} className="mono" style={{ fontSize: 12, color: 'var(--fg2)',
                        background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 8, padding: '2px 8px' }}>
                        {num.v}
                      </span>))}
                  </div>)}
              </div>
            ))}
          </Card>
        </div>
      ))}

      <p className="dim sm" style={{ marginTop: 16, lineHeight: 1.6, fontSize: 10.5 }}>
        Har number public listings se cross-check kiya gaya hai. Sarkari helplines kabhi kabhi badal jaati
        hain — zaroori baat ho to official website se confirm kar lein. WhatsApp button sirf un numbers ke
        liye hai jo mobile hain. Emergency mein 112 sabse pehle try karein.
      </p>
    </div>
  );
}
