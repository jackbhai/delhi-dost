/**
 * Travel hubs — one screen per mode, so nothing is confusing.
 *
 * The Travel category had eleven separate tiles (Trains, Live Train, Train
 * Schedule, Train Journey, Metro, Metro Route, Metro Network, Metro Lines,
 * Bus Route, Bus Routes, Plan Journey) and it was impossible to tell which
 * one to open. They are now three hubs — BUS, TRAIN, METRO — plus the
 * combined planner. Each hub keeps every feature, grouped under tabs.
 */
import React, { useState } from 'react';
import { Icon } from '../ui/icons';

/** Shared shell: an icon header, a tab strip and the active panel. */
export function Hub({ icon, title, sub, tabs, initial = 0 }) {
  const [i, setI] = useState(initial);
  const Active = tabs[i].C;
  return (<>
    <div className="hubhead">
      <div className="hubico"><Icon n={icon} size={26} /></div>
      <div style={{ minWidth: 0 }}>
        <b>{title}</b>
        <span className="dim sm">{sub}</span>
      </div>
    </div>

    <div className="tabs" role="tablist">
      {tabs.map((t, n) => (
        <button key={t.id} role="tab" aria-selected={i === n}
          className={`tab ${i === n ? 'on' : ''}`} onClick={() => setI(n)}>
          <Icon n={t.i} size={17} />
          <span>{t.n}</span>
        </button>))}
    </div>

    <div style={{ paddingTop: 12 }}><Active /></div>
  </>);
}
