/**
 * Settings Page - Standard settings with themes + PWA + Live Check System
 * Features:
 * - PWA install, offline status, cache management
 * - Themes: dark, light, amoled, ocean, forest, sunset, midnight + Make Your Own Theme
 * - Features enable/disable
 * - Live Check System with button, % working, live logs
 */

import React, { useState, useEffect, useRef } from 'react';
import { Card, Stat } from '../ui/kit';
import { Icon } from '../ui/icons';
import { THEMES, getCurrentThemeId, getCustomTheme, saveCustomTheme, applyTheme, getAllThemes } from '../core/theme.js';
import { getPWAInfo, triggerInstall, onInstallPrompt, getCacheStatus, clearAllCaches, getOfflineStatus } from '../core/pwa.js';
import { runLiveCheck, getFeatureCategories } from '../core/live-check.js';
import { getSettings, setSetting, onSettings } from '../core/settings.js';
/* The switch is a checkbox; these are the sounds it switches. Both come from the
   one module the app itself listens through, so what is heard here is exactly
   what is heard in a tool — no separate demo audio. */
import { play as sfxPlay, soundLog as sfxLog, SOUNDS as SFX, supported as sfxSupported } from '../core/sfx.js';

export function Settings() {
  const [currentTheme, setCurrentTheme] = useState(getCurrentThemeId());
  const [customTheme, setCustomTheme] = useState(getCustomTheme());
  const [showCustomMaker, setShowCustomMaker] = useState(false);
  const [customColors, setCustomColors] = useState({
    '--bg': '#000000',
    '--s1': '#080B0A',
    '--s2': '#0E1412',
    '--s3': '#141C19',
    '--line': '#1C2724',
    '--line2': '#26332F',
    '--green': '#00FF9C',
    '--cyan': '#00E5FF',
    '--fg': '#E8FFF4',
    '--fg2': '#9DB5AC',
    '--fg3': '#5E736C',
  });
  const [customName, setCustomName] = useState('My Custom Theme');
  const [pwaInfo, setPwaInfo] = useState(null);
  const [cacheInfo, setCacheInfo] = useState(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installStatus, setInstallStatus] = useState('');
  const [liveCheckResult, setLiveCheckResult] = useState(null);
  const [liveLogs, setLiveLogs] = useState([]);
  const [liveProgress, setLiveProgress] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [settings, setSettingsState] = useState(getSettings());
  const [sfxLast, setSfxLast] = useState('');
  const logRef = useRef(null);

  /* Two switches write this one preference - the speaker in the header and the
     checkbox here - so this page has to listen, or it shows a state the app has
     already left behind. Subscribing costs nothing and cannot go stale. */
  useEffect(() => onSettings((s) => setSettingsState(s)), []);

  /* What the button does is call the same play() a tool calls, and what prints
     under it is that call's answer — including "sounds are off", so a silent
     button is never mistaken for a broken one. */
  const hear = (name) => {
    sfxPlay(name);
    const l = sfxLog()[sfxLog().length - 1];
    setSfxLast(l ? `${SFX[l.name] ? SFX[l.name].label : l.name}${l.ok ? '' : ' — ' + l.why}` : '');
  };

  useEffect(() => {
    // Init theme
    setCurrentTheme(getCurrentThemeId());
    setCustomTheme(getCustomTheme());
    
    // PWA info
    setPwaInfo(getPWAInfo());
    getCacheStatus().then(setCacheInfo);
    
    // Install prompt
    onInstallPrompt(() => setCanInstall(true));
    
    // Update PWA info periodically
    const interval = setInterval(() => {
      setPwaInfo(getPWAInfo());
      getCacheStatus().then(setCacheInfo);
    }, 3000);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Auto-scroll logs
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [liveLogs]);

  const handleThemeChange = (themeId) => {
    const theme = applyTheme(themeId);
    setCurrentTheme(themeId);
    setInstallStatus(`Theme changed to ${theme.name}`);
    setTimeout(() => setInstallStatus(''), 2000);
  };

  const handleCustomColorChange = (varName, value) => {
    setCustomColors(prev => ({ ...prev, [varName]: value }));
  };

  const handleSaveCustomTheme = () => {
    const newCustom = {
      id: 'custom',
      name: customName || 'My Custom Theme',
      nameHi: 'मेरा कस्टम थीम',
      description: `Custom theme created by user - ${new Date().toLocaleString()}`,
      colors: customColors,
      isDark: isColorDark(customColors['--bg']),
      createdAt: new Date().toISOString(),
    };
    
    if (saveCustomTheme(newCustom)) {
      setCustomTheme(newCustom);
      applyTheme('custom');
      setCurrentTheme('custom');
      setShowCustomMaker(false);
      setInstallStatus(`Custom theme "${customName}" saved and applied!`);
      setTimeout(() => setInstallStatus(''), 3000);
    } else {
      setInstallStatus('Failed to save custom theme - storage full?');
    }
  };

  const handleInstall = async () => {
    setInstallStatus('Triggering install prompt...');
    const result = await triggerInstall();
    if (result.ok) {
      setInstallStatus(result.accepted ? 'Install accepted! App will be installed.' : `Install prompt: ${result.outcome}`);
    } else {
      setInstallStatus(`Cannot install: ${result.reason} - Try using browser menu "Add to Home Screen" or "Install App"`);
    }
    setTimeout(() => setInstallStatus(''), 4000);
  };

  const handleClearCache = async () => {
    setInstallStatus('Clearing caches...');
    const result = await clearAllCaches();
    if (result.ok) {
      setInstallStatus(`Cleared ${result.deleted} caches - Reload to refetch`);
      getCacheStatus().then(setCacheInfo);
    } else {
      setInstallStatus(`Clear failed: ${result.reason}`);
    }
    setTimeout(() => setInstallStatus(''), 3000);
  };

  const handleLiveCheck = async () => {
    setIsChecking(true);
    setLiveLogs([]);
    setLiveCheckResult(null);
    setLiveProgress({ current: 0, total: 20, percent: 0, checkName: 'Starting...' });

    const result = await runLiveCheck({
      onLog: (entry) => {
        setLiveLogs(prev => [...prev, entry]);
      },
      onProgress: (prog) => {
        setLiveProgress(prog);
      },
    });

    setLiveCheckResult(result);
    setIsChecking(false);
    setLiveProgress(null);
  };

  const isColorDark = (hex) => {
    if (!hex || !hex.startsWith('#')) return true;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128;
  };

  const allThemes = getAllThemes();

  return (
    <>
      <Card>
        <div className="chead"><Icon n="cog" size={18} /> Settings - Standard - PWA + Themes + Live Check</div>
        <div className="dim sm">App-like PWA experience + Custom themes + Live feature health check with real-time logs - Professional settings page</div>
        
        {installStatus && (
          <div style={{ marginTop: 12, padding: 10, background: 'var(--s2)', borderRadius: 10, borderLeft: '3px solid var(--green)', fontSize: 12 }}>
            {installStatus}
          </div>
        )}

        {/* PWA Section */}
        <Card style={{ marginTop: 16, background: 'var(--s2)' }}>
          <div className="chead"><Icon n="box" size={16} /> PWA - App-like Experience - Install as App</div>
          <div className="dim sm">Progressive Web App - Use like native app, works offline, install to home screen</div>
          
          <div className="g2" style={{ marginTop: 12 }}>
            <Stat l="Display Mode" v={pwaInfo?.displayMode || 'Checking...'} />
            <Stat l="Installed" v={pwaInfo?.isInstalled ? 'Yes - App-like' : 'No - Browser'} />
            <Stat l="Service Worker" v={pwaInfo?.serviceWorker?.status || 'Checking...'} />
            <Stat l="Online" v={pwaInfo?.offline?.online ? 'Online' : 'Offline'} />
            <Stat l="Can Install" v={canInstall ? 'Yes - Prompt ready' : pwaInfo?.isStandalone ? 'Already installed' : 'Use browser menu'} />
            <Stat l="Cache Count" v={cacheInfo?.totalCaches ? `${cacheInfo.totalCaches} caches` : 'Checking...'} />
          </div>

          {pwaInfo?.offline?.connection && (
            <div style={{ marginTop: 10, padding: 8, background: 'var(--s1)', borderRadius: 8, fontSize: 11 }}>
              <b>Connection:</b> {pwaInfo.offline.connection.effectiveType} | Downlink {pwaInfo.offline.connection.downlink}Mbps | RTT {pwaInfo.offline.connection.rtt}ms | SaveData {pwaInfo.offline.connection.saveData ? 'Yes' : 'No'}
            </div>
          )}

          {cacheInfo?.caches && cacheInfo.caches.length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 100, overflow: 'auto', fontSize: 10, background: 'var(--s1)', padding: 8, borderRadius: 8 }}>
              {cacheInfo.caches.map((c, i) => (
                <div key={i}>{c.name}: {c.count} items</div>
              ))}
            </div>
          )}

          <div className="btnrow" style={{ marginTop: 12 }}>
            <button className="btn" onClick={handleInstall} disabled={!canInstall && !pwaInfo?.isStandalone}>
              <Icon n="download" size={14} /> {pwaInfo?.isStandalone ? 'Already Installed as App' : canInstall ? 'Install as App - One Click' : 'Install via Browser Menu'}
            </button>
            <button className="btn ghost" onClick={handleClearCache}>
              <Icon n="refresh" size={14} /> Clear All Caches
            </button>
            <button className="btn ghost" onClick={() => { setPwaInfo(getPWAInfo()); getCacheStatus().then(setCacheInfo); }}>
              <Icon n="search" size={14} /> Refresh PWA Status
            </button>
          </div>

          <div className="dim sm" style={{ marginTop: 10, fontSize: 11, lineHeight: 1.4 }}>
            <b>How to install as app:</b><br/>
            • Chrome/Edge: Menu (⋮) → "Install app" or "Add to Home Screen" or address bar install icon<br/>
            • Safari iOS: Share (⎙) → "Add to Home Screen"<br/>
            • Firefox: Menu → "Install"<br/>
            • Once installed, opens in standalone mode - no browser UI, app-like, works offline<br/>
            • Service worker caches app shell (network-first for index.html, cache-first for hashed assets)<br/>
            • Offline maps & schedules ready after first use - cached for no-signal journeys
          </div>
        </Card>

        {/* Themes Section */}
        <Card style={{ marginTop: 16, background: 'var(--s2)' }}>
          <div className="chead"><Icon n="palette" size={16} /> Themes - Standard + Make Your Own</div>
          <div className="dim sm">Choose theme or create your own custom theme - All themes use real SVG icons, no emoji - AMOLED battery saving</div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {Object.entries(allThemes).map(([id, theme]) => (
              <button
                key={id}
                onClick={() => handleThemeChange(id)}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: currentTheme === id ? `2px solid ${theme.colors['--green']}` : '1px solid var(--line)',
                  background: theme.colors['--s1'],
                  color: theme.colors['--fg'],
                  textAlign: 'left',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {currentTheme === id && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, color: theme.colors['--green'] }}>● Active</span>}
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, background: theme.colors['--bg'], border: `1px solid ${theme.colors['--line']}` }} />
                  <span style={{ width: 16, height: 16, borderRadius: 4, background: theme.colors['--green'] }} />
                  <span style={{ width: 16, height: 16, borderRadius: 4, background: theme.colors['--cyan'] }} />
                  <span style={{ width: 16, height: 16, borderRadius: 4, background: theme.colors['--s2'] }} />
                </div>
                <b style={{ fontSize: 12 }}>{theme.name}</b>
                <div style={{ fontSize: 10, color: theme.colors['--fg2'], marginTop: 2, lineHeight: 1.3 }}>{theme.description}</div>
                <div style={{ fontSize: 9, color: theme.colors['--fg3'], marginTop: 4 }}>{theme.isDark ? 'Dark' : 'Light'} | {Object.keys(theme.colors).length} colors</div>
              </button>
            ))}
          </div>

          <div className="btnrow" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setShowCustomMaker(!showCustomMaker)}>
              <Icon n="pen" size={14} /> {showCustomMaker ? 'Close Custom Maker' : 'Make Your Own Theme - Custom Colors'}
            </button>
            {customTheme && (
              <button className="btn ghost" onClick={() => { localStorage.removeItem('dost:custom-theme'); setCustomTheme(null); if (currentTheme === 'custom') handleThemeChange('dark'); }}>
                <Icon n="x" size={14} /> Delete Custom Theme
              </button>
            )}
          </div>

          {showCustomMaker && (
            <Card style={{ marginTop: 12, background: 'var(--s1)', border: '1px solid var(--line2)' }}>
              <div className="chead"><Icon n="palette" size={14} /> Make Your Own Theme - Custom Color Picker</div>
              <div className="dim sm">Pick colors for each variable - Preview live - Save as custom theme - Professional theming system</div>
              
              <div className="fld" style={{ marginTop: 10 }}>
                <label>Theme Name</label>
                <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="My Custom Theme" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
                {Object.entries(customColors).map(([varName, color]) => (
                  <div key={varName} className="fld" style={{ marginBottom: 0 }}>
                    <label>{varName} - {varName.replace('--', '')}</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="color" value={color} onChange={e => handleCustomColorChange(varName, e.target.value)} style={{ width: 40, height: 36, padding: 2, borderRadius: 8 }} />
                      <input value={color} onChange={e => handleCustomColorChange(varName, e.target.value)} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} placeholder="#000000" />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, padding: 12, background: customColors['--bg'], borderRadius: 12, border: `1px solid ${customColors['--line']}` }}>
                <div style={{ color: customColors['--fg'], fontSize: 14, fontWeight: 600 }}>Preview: {customName}</div>
                <div style={{ color: customColors['--fg2'], fontSize: 12, marginTop: 4 }}>This is how your theme will look - Background {customColors['--bg']} with green {customColors['--green']} and cyan {customColors['--cyan']}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <span style={{ padding: '4px 8px', borderRadius: 6, background: customColors['--s2'], color: customColors['--fg'], fontSize: 10, border: `1px solid ${customColors['--line']}` }}>Card s2</span>
                  <span style={{ padding: '4px 8px', borderRadius: 6, background: customColors['--green'], color: '#000', fontSize: 10, fontWeight: 700 }}>Button</span>
                  <span style={{ padding: '4px 8px', borderRadius: 6, background: customColors['--s1'], color: customColors['--fg3'], fontSize: 10, border: `1px solid ${customColors['--line']}` }}>Dim</span>
                </div>
              </div>

              <div className="btnrow" style={{ marginTop: 12 }}>
                <button className="btn" onClick={handleSaveCustomTheme}>
                  <Icon n="save" size={14} /> Save Custom Theme "{customName}"
                </button>
                <button className="btn ghost" onClick={() => { setCustomColors({ '--bg': '#000000', '--s1': '#080B0A', '--s2': '#0E1412', '--s3': '#141C19', '--line': '#1C2724', '--line2': '#26332F', '--green': '#00FF9C', '--cyan': '#00E5FF', '--fg': '#E8FFF4', '--fg2': '#9DB5AC', '--fg3': '#5E736C' }); }}>
                  Reset to Default
                </button>
              </div>
            </Card>
          )}
        </Card>

        {/* Features Toggle */}
        <Card style={{ marginTop: 16, background: 'var(--s2)' }}>
          <div className="chead"><Icon n="cog" size={16} /> Features - Standard Settings</div>
          <div className="dim sm">Enable/disable features, proxy settings, and more</div>
          
          <div style={{ marginTop: 12 }}>
            <label className="chk">
              <input type="checkbox" checked={settings.autoRadio} onChange={e => { const s = setSetting('autoRadio', e.target.checked); setSettingsState(s); }} />
              <span>Auto Radio - Keep queue topped up so playback never ends (Music player)</span>
            </label>
            <label className="chk">
              <input type="checkbox" checked={settings.sfx} onChange={e => { const s = setSetting('sfx', e.target.checked); setSettingsState(s); }} />
              <span>Sound effects - the whole app, not only travel: a train going past when you open a tool, a tick on a button or a filter, air going the other way when you leave, a bell when a get-off alert arms and three bells when it fires. Every one is synthesised in your browser - no audio file is downloaded, nothing is cached</span>
            </label>
            <div className="btnrow" style={{ marginTop: 8 }}>
              {[['tick', 'Hear a tap'], ['whoosh', 'Hear a tool open'], ['back', 'Hear a leave'], ['chime', 'Hear an answer'], ['ding', 'Hear an alert armed']].map(([n, l]) => (
                <button key={n} className="btn ghost" onClick={() => hear(n)}>{l}</button>
              ))}
            </div>
            <div className="dim sm" style={{ fontSize: 10, marginTop: 6 }}>
              {!sfxSupported() ? 'This browser has no Web Audio - nothing can play and nothing is fetched.'
                : settings.sfx === false ? 'Switched off above, so these buttons answer with the reason, not a sound.'
                : sfxLast ? `Last: ${sfxLast}` : 'Seven sounds in all; a backgrounded tab keeps only the get-off bell.'}
              <br />The same switch sits at the top right of every screen, and each travel panel keeps its own copy of it - one preference, three places to reach it, never out of step.
            </div>
            <label className="chk">
              <input type="checkbox" checked={settings.useBuiltin} onChange={e => { const s = setSetting('useBuiltin', e.target.checked); setSettingsState(s); }} />
              <span>Use built-in relay — automatic fallback whenever a live call cannot be reached directly</span>
            </label>
            <div className="fld" style={{ marginTop: 10 }}>
              <label>Custom Proxy URL (optional) - Your own Cloudflare Worker - Takes priority over built-in</label>
              <input value={settings.proxyUrl} onChange={e => { const s = setSetting('proxyUrl', e.target.value); setSettingsState(s); }} placeholder="https://your-worker.workers.dev" />
              <div className="dim sm" style={{ fontSize: 10, marginTop: 4 }}>Free daily tier — guarded by host allow-list so it cannot be used as an open relay</div>
            </div>
          </div>
        </Card>

        {/* Live Check System */}
        <Card style={{ marginTop: 16, border: '2px solid var(--green)', background: 'var(--s2)' }}>
          <div className="chead"><Icon n="signal" size={18} /> Live Check System - Feature Health + % Working + Live Logs</div>
          <div className="dim sm">One button checks all features - Which working, which not, % working per category, live logs show what is being checked in real-time - Professional QA system</div>

          <div className="btnrow" style={{ marginTop: 12 }}>
            <button className="btn" style={{ flex: 1 }} onClick={handleLiveCheck} disabled={isChecking}>
              <Icon n={isChecking ? "refresh" : "search"} size={16} /> {isChecking ? `Checking... ${liveProgress?.percent || 0}% - ${liveProgress?.checkName || ''}` : 'Run Live Check - Check All Features Health'}
            </button>
            <button className="btn ghost" onClick={() => { setLiveCheckResult(null); setLiveLogs([]); setLiveProgress(null); }}>
              <Icon n="x" size={14} /> Clear
            </button>
          </div>

          {liveProgress && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg3)', marginBottom: 4 }}>
                <span>{liveProgress.checkName}</span>
                <span>{liveProgress.current}/{liveProgress.total} - {liveProgress.percent}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${liveProgress.percent}%`, background: 'var(--grad)', transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {liveCheckResult && (
            <>
              <div className="g3" style={{ marginTop: 16 }}>
                <Stat l="Total Features" v={liveCheckResult.summary.total} />
                <Stat l="Passed" v={liveCheckResult.summary.passed} />
                <Stat l="Failed" v={liveCheckResult.summary.failed} />
                <Stat l="Warnings" v={liveCheckResult.summary.warnings} />
                <Stat l="Overall %" v={`${liveCheckResult.summary.overallPercent}%`} />
                <Stat l="Status" v={liveCheckResult.summary.overallStatus.toUpperCase()} />
              </div>

              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {Object.entries(getFeatureCategories(liveCheckResult.results)).map(([cat, data]) => (
                  <Card key={cat} style={{ padding: 10, background: 'var(--s1)', border: `1px solid ${data.percent >= 90 ? 'var(--green)' : data.percent >= 70 ? 'var(--warn)' : 'var(--bad)'}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{cat} - {data.percent}%</div>
                    <div style={{ fontSize: 10, color: 'var(--fg3)', marginTop: 2 }}>{data.passed} pass, {data.warnings} warn, {data.failed} fail of {data.total}</div>
                    <div style={{ height: 4, background: 'var(--line2)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${data.percent}%`, background: data.percent >= 90 ? 'var(--green)' : data.percent >= 70 ? 'var(--warn)' : 'var(--bad)' }} />
                    </div>
                    <div style={{ marginTop: 6, fontSize: 9 }}>
                      {data.features.slice(0, 3).map((f, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>{f.name}</span>
                          <span style={{ color: f.status === 'pass' ? 'var(--green)' : f.status === 'warn' ? 'var(--warn)' : 'var(--bad)' }}>{f.percent}% {f.status === 'pass' ? '✓' : f.status === 'warn' ? '!' : '✗'}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="chead" style={{ fontSize: 11 }}>All Features Detailed - % Working</div>
                <div className="list" style={{ maxHeight: 300, overflow: 'auto' }}>
                  {liveCheckResult.results.map((r, i) => (
                    <div key={i} className="row" style={{ padding: '8px 12px' }}>
                      <span className={`dot ${r.status === 'pass' ? '' : r.status === 'warn' ? 'warn' : 'bad'}`} />
                      <div className="main" style={{ flex: 1 }}>
                        <b style={{ fontSize: 12 }}>{r.name} - {r.percent}% - {r.status.toUpperCase()}</b>
                        <span className="dim sm" style={{ fontSize: 10 }}>{r.details}</span>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: r.status === 'pass' ? 'var(--green)' : r.status === 'warn' ? 'var(--warn)' : 'var(--bad)' }}>{r.percent}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <div className="chead" style={{ fontSize: 11 }}><Icon n="code" size={12} /> Live Logs - Real-time - What is being checked</div>
            <div ref={logRef} style={{ background: '#000', color: '#0f0', fontFamily: 'monospace', fontSize: 10, padding: 10, borderRadius: 8, maxHeight: 250, overflow: 'auto', border: '1px solid var(--line2)' }}>
              {liveLogs.length === 0 ? (
                <div style={{ color: '#666' }}>No logs yet - Click "Run Live Check" to see real-time logs of what is being checked...</div>
              ) : (
                liveLogs.map((log, i) => (
                  <div key={i} style={{ color: log.type === 'pass' ? '#0f0' : log.type === 'fail' ? '#f00' : log.type === 'warn' ? '#ff0' : '#0ff', marginBottom: 2 }}>
                    [{log.time}] {log.type.toUpperCase()}: {log.message}
                  </div>
                ))
              )}
              {isChecking && <div style={{ color: '#0ff' }}>▶ Checking in progress... {liveProgress?.checkName} {liveProgress?.percent}%</div>}
            </div>
          </div>

          <div className="dim sm" style={{ marginTop: 10, fontSize: 11, lineHeight: 1.4 }}>
            <b>Live Check System Features:</b><br/>
            • Checks the health of this app: offline tools, live channels (provider health), PWA (service worker, cache, standalone, manifest), theme system (7 themes + custom), storage (LocalStorage, Cache API, IndexedDB), transit data and the live-buses relay<br/>
            • Shows % working per feature and per category, overall % health<br/>
            • Live logs with timestamp, type (info/pass/warn/fail), real-time what is being checked<br/>
            • Progress bar with current/total/percent/check name<br/>
            • Provider stats integration - shows which providers healthy/failing<br/>
            • Professional QA - same system used for pre-commit checks
          </div>
        </Card>
      </Card>

      <div className="src"><span className="dot" /><span>Settings v1.0 - PWA App-like + Themes 7 + Custom Theme Maker + Live Check System - PWA: standalone display, SW network-first shell cache-first hashed assets, offline ready, install prompt, cache management - Themes: dark default AMOLED black + light + amoled pure black + ocean + forest + sunset + midnight purple + custom maker with color pickers for --bg --s1 --s2 --s3 --line --green --cyan --fg etc live preview save to localStorage - Features: proxy settings autoRadio useBuiltin sfx (app-wide sound effects, synthesised locally, with audible test buttons) - Live Check: button checks all features health % working per feature/category overall % with live logs timestamp type real-time progress - Professional settings page - No fake data - Verified</span></div>
    </>
  );
}
