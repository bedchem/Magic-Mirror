import { useState, useCallback, useRef, useEffect } from 'react';
import HandTrackingService from '../components/HandTrackingService';
import WidgetDragManager from '../components/WidgetDragManager';
import notificationImage from '../assets/notification.png';

const DEBUG = true;

const defaultSettings = {
  enabled: true,
  showPreview: DEBUG,
  cameraOrientation: 'landscape',
  cameraPosition: 'top',
  smoothing: 0.2,
  sensitivity: 1,
  preprocessingQuality: 'max',
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
  pinchSensitivity: 0.2,
};

const ACTIVE_COLOR = '59,130,246';
const ACTIVE_DOT = '147,197,253';
const GRAY_COLOR = '120,120,120';
const GRAY_DOT = '180,180,180';

const NAV_ITEMS = [
  { label: 'Datetime', widgetId: 'DatetimeWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" /></svg>) },
  { label: 'Kalender', widgetId: 'KalenderWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>) },
  { label: 'Timer', widgetId: 'TimerWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><circle cx="12" cy="13" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 13l3-2" /><path d="M9 2h6" /></svg>) },
  { label: 'Wetter', widgetId: 'WetterWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><path d="M17.5 19a4.5 4.5 0 000-9 6 6 0 10-11.7 1.5A3.5 3.5 0 006 19h11.5z" /></svg>) },
  { label: 'Stundenplan', widgetId: 'StundenplanWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="10" x2="8" y2="22" /><line x1="16" y1="10" x2="16" y2="22" /></svg>) },
  { label: 'Stocks', widgetId: 'StocksWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /><circle cx="7" cy="14" r="1" /><circle cx="11" cy="10" r="1" /><circle cx="14" cy="13" r="1" /><circle cx="19" cy="7" r="1" /></svg>) },
  { label: 'News', widgetId: 'NewsWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="7" y1="8" x2="17" y2="8" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="7" y1="16" x2="13" y2="16" /></svg>) },
  { label: 'Zeichnen', widgetId: 'ZeichnenWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>) },
  { label: 'Spotify', widgetId: 'SpotifyWidget', icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="30" height="30"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>) },
];

const MIN_INTERVAL = 3 * 60 * 1000;
const MAX_INTERVAL = 10 * 60 * 1000;
function getRandomInterval() {
  return Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function LockClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const date = time.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
  return (
    <div className="lock-clock">
      <div className="lock-clock__time">{hh}<span className="lock-clock__sep">:</span>{mm}</div>
      <div className="lock-clock__date">{date}</div>
    </div>
  );
}

function UUIDModal({ onConfirm, onCancel }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!UUID_REGEX.test(trimmed)) {
      setError('Ungültige UUID — Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onConfirm(trimmed);
    } catch (e) {
      setError('Fehler beim Speichern des Users');
    } finally {
      setLoading(false);
    }
  }, [value, onConfirm]);

  const handleKey = useCallback((e) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onCancel();
  }, [handleSubmit, onCancel]);

  return (
    <div className="uuid-modal-overlay">
      <div className="uuid-modal">
        <h2 className="uuid-modal__title">User-ID eingeben</h2>
        <p className="uuid-modal__subtitle">UUID des Nutzers</p>
        <input
          ref={inputRef}
          className={`uuid-modal__input${error ? ' uuid-modal__input--error' : ''}`}
          type="text"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={value}
          onChange={e => { setValue(e.target.value); setError(''); }}
          onKeyDown={handleKey}
          spellCheck={false}
        />
        {error && <p className="uuid-modal__error">{error}</p>}
        <div className="uuid-modal__actions">
          <button className="uuid-modal__btn uuid-modal__btn--cancel" onClick={onCancel} disabled={loading}>
            Abbrechen
          </button>
          <button className="uuid-modal__btn uuid-modal__btn--confirm" onClick={handleSubmit} disabled={loading}>
            {loading ? '…' : 'Anmelden'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LockScreen({ onUnlock, demoMode = false }) {
  const [phase, setPhase] = useState('idle');
  const [showModal, setShowModal] = useState(false);

  const triggerUnlock = useCallback((uuid) => {
    if (phase !== 'idle') return;
    setShowModal(false);
    setPhase('confirm');
    setTimeout(() => {
      setPhase('out');
      setTimeout(() => onUnlock(uuid), 350);
    }, 950);
  }, [phase, onUnlock]);

  const handleClick = useCallback(() => {
    if (!demoMode) return;
    setShowModal(true);
  }, [demoMode]);

  return (
    <div className={`lock-screen lock-screen--${phase}`}>
      <LockClock />

      <div className="lock-center">
        <button
          className="lock-tap"
          onClick={handleClick}
          aria-label="Anmelden"
          style={{ cursor: demoMode ? 'pointer' : 'default' }}
        >
          <span className="lock-ring lock-ring--a" />
          <span className="lock-ring lock-ring--b" />
          <span className="lock-ring lock-ring--c" />

          <span className="lock-core">
            {phase === 'idle' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="30" height="30">
                <path d="M20 7C20 7 19 4 12 4S4 7 4 7" strokeLinecap="round" />
                <path d="M20 17C20 17 19 20 12 20S4 17 4 17" strokeLinecap="round" />
                <path d="M17 7C17 7 16.5 5.5 12 5.5S7 7 7 7" strokeLinecap="round" />
                <path d="M17 17C17 17 16.5 18.5 12 18.5S7 17 7 17" strokeLinecap="round" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            ) : (
              <svg className="lock-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="30" height="30">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        </button>

        <p className="lock-hint">
          {phase === 'idle' ? 'NFC-Chip ans Gerät halten' : 'Zugang gewährt'}
        </p>
      </div>

      {showModal && (
        <UUIDModal
          onConfirm={triggerUnlock}
          onCancel={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function HandNav({ handPositions, onSpawnWidget }) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const plusRef = useRef(null);
  const itemRefs = useRef([]);
  const wasPinching = useRef({});

  useEffect(() => {
    const positions = Object.values(handPositions);
    if (!positions.length) return;
    const plusEl = plusRef.current;
    if (!plusEl) return;
    const plusRect = plusEl.getBoundingClientRect();
    let handOverMenu = false;
    for (const pos of positions) {
      if (!pos.detected || pos.palmVisible === false) continue;
      const { x, y, isPinching, handIndex } = pos;
      const MARGIN = 40;
      const overPlus = x >= plusRect.left - MARGIN && x <= plusRect.right + MARGIN && y >= plusRect.top - MARGIN && y <= plusRect.bottom + MARGIN;
      if (overPlus) handOverMenu = true;
      if (expanded) {
        let found = null;
        itemRefs.current.forEach((el, i) => {
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 10 && y <= r.bottom + 10) { found = i; handOverMenu = true; }
        });
        setHoveredIdx(found);
        if (isPinching && !wasPinching.current[handIndex] && found !== null) onSpawnWidget(NAV_ITEMS[found].widgetId);
      }
      wasPinching.current[handIndex] = isPinching;
    }
    setExpanded(handOverMenu);
    if (!handOverMenu) setHoveredIdx(null);
  }, [handPositions, expanded, onSpawnWidget]);

  return (
    <>
      <button ref={plusRef} onClick={() => setExpanded(v => !v)} className="hand-nav__toggle" data-expanded={expanded}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
      <nav className="hand-nav__list">
        {NAV_ITEMS.map((item, i) => {
          const isHovered = hoveredIdx === i;
          return (
            <div key={item.label} ref={el => { itemRefs.current[i] = el; }} className="hand-nav__item" data-expanded={expanded} style={{ transitionDelay: `${50 + i * 60}ms` }}>
              <button onClick={() => onSpawnWidget(item.widgetId)} className="hand-nav__btn" data-hovered={isHovered}>{item.icon}</button>
              {isHovered && <span className="hand-nav__label">{item.label}</span>}
            </div>
          );
        })}
      </nav>
    </>
  );
}

function LiveCursor({ handIndex }) {
  const cursorRef = useRef(null);
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  useEffect(() => {
    if (!window.__updateHandCursor) window.__updateHandCursor = {};
    window.__updateHandCursor[handIndex] = (pos) => {
      const el = cursorRef.current; const dot = dotRef.current; const ring = ringRef.current;
      if (!el) return;
      if (!pos.detected) { el.style.opacity = '0'; return; }
      el.style.opacity = '1';
      el.style.transform = `translate(${pos.x - 20}px, ${pos.y - 20}px)`;
      const palmOk = pos.palmVisible !== false;
      const rc = palmOk ? ACTIVE_COLOR : GRAY_COLOR;
      const dc = palmOk ? ACTIVE_DOT : GRAY_DOT;
      const s = palmOk ? (pos.pinchStrength || 0) : 0;
      const isPinching = palmOk && (pos.isPinching || false);
      const size = 40 - s * 10;
      ring.style.width = `${size}px`; ring.style.height = `${size}px`;
      ring.style.borderColor = `rgba(${rc},${isPinching ? 0.8 + s * 0.2 : 0.75})`;
      ring.style.boxShadow = palmOk ? `0 0 ${20 + s * 20}px rgba(${rc},${0.6 + s * 0.3}), 0 0 ${40 + s * 40}px rgba(${rc},${0.3 + s * 0.2})` : 'none';
      ring.style.borderWidth = `${isPinching ? 3 + s * 2 : 3}px`;
      ring.style.background = `rgba(${rc},${palmOk ? 0.12 : 0.06})`;
      const dotSize = palmOk ? 4 + s * 4 : 3;
      dot.style.width = `${dotSize}px`; dot.style.height = `${dotSize}px`;
      dot.style.background = `rgba(${dc},1)`;
      dot.style.boxShadow = palmOk ? `0 0 8px rgba(${dc},1)` : 'none';
    };
    return () => { if (window.__updateHandCursor) delete window.__updateHandCursor[handIndex]; };
  }, [handIndex]);
  return (
    <div ref={cursorRef} className="live-cursor">
      <div ref={ringRef} className="live-cursor__ring live-cursor__ring--circle" />
      <div ref={dotRef} className="live-cursor__dot" />
    </div>
  );
}

function HandStatusDot({ status, index }) {
  let dotColor, label;
  if (!status.detected) { dotColor = '#ef4444'; label = `H${index + 1} —`; }
  else if (!status.palmVisible) { dotColor = '#888'; label = `H${index + 1} back`; }
  else if (status.isPinching) { dotColor = '#f59e0b'; label = `H${index + 1} pinch`; }
  else { dotColor = `rgb(${ACTIVE_DOT})`; label = `H${index + 1} palm`; }
  return (
    <div className="status-bar__entry">
      <div className="status-bar__dot" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
      <span className="status-bar__label">{label}</span>
    </div>
  );
}

function StatusBar({ statuses }) {
  return (
    <div className="status-bar">
      {statuses.map((s, i) => <HandStatusDot key={i} status={s} index={i} />)}
    </div>
  );
}

function LogoutButton({ onLogout }) {
  return (
    <button className="logout-btn" onClick={onLogout} title="Abmelden">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
      </svg>
    </button>
  );
}

export default function IndexPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [statuses, setStatuses] = useState([
    { detected: false, isPinching: false, palmVisible: false },
    { detected: false, isPinching: false, palmVisible: false },
  ]);
  const [handPositions, setHandPositions] = useState({});
  const [compliment, setCompliment] = useState('');
  const [complimentLoopStarted, setComplimentLoopStarted] = useState(false);
  const [savedWidgetPositions, setSavedWidgetPositions] = useState([]);
  const videoRef = useRef(null);
  const complimentRequestedRef = useRef(false);
  const intervalRef = useRef(null);
  const spawnRef = useRef(null);
  const activeWidgetsRef = useRef([]);
  const saveTimeoutRef = useRef(null);

  const takeComplimentPhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append('image', blob, 'webcam.jpg');
        try {
          const res = await fetch('http://localhost:3000/api/compliment', { method: 'POST', body: formData });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          setCompliment(text);
          setTimeout(() => setCompliment(''), 10000);
        } catch (e) { console.error('Compliment fetch error:', e); }
      }, 'image/jpeg', 0.9);
    } catch (e) { console.error('Canvas error:', e); }
  }, []);

  useEffect(() => {
    if (!complimentLoopStarted) return;
    const scheduleNext = () => {
      intervalRef.current = setTimeout(async () => { await takeComplimentPhoto(); scheduleNext(); }, getRandomInterval());
    };
    scheduleNext();
    return () => clearTimeout(intervalRef.current);
  }, [complimentLoopStarted, takeComplimentPhoto]);

  const loadWidgetPositions = useCallback(async (uuid) => {
    try {
      const res = await fetch(`http://localhost:3000/api/widget-positions/${uuid}`);
      if (!res.ok) return [];
      const rows = await res.json();
      return rows.map(r => ({ id: r.instance_id, widgetId: r.widget_id, x: r.x, y: r.y }));
    } catch (e) {
      console.error('Widget positions load error:', e);
      return [];
    }
  }, []);

  const persistWidgetPositions = useCallback((uuid, widgets) => {
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await fetch(`http://localhost:3000/api/widget-positions/${uuid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgets }),
        });
      } catch (e) {
        console.error('Widget positions save error:', e);
      }
    }, 800);
  }, []);

  const deletePersistedWidget = useCallback(async (uuid, instanceId) => {
    try {
      await fetch(`http://localhost:3000/api/widget-positions/${uuid}/${instanceId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Widget position delete error:', e);
    }
  }, []);

  const handleWidgetsChange = useCallback((widgets) => {
    activeWidgetsRef.current = widgets;
    if (currentUser) persistWidgetPositions(currentUser, widgets);
  }, [currentUser, persistWidgetPositions]);

  const handleWidgetRemoved = useCallback((instanceId) => {
    if (currentUser) deletePersistedWidget(currentUser, instanceId);
  }, [currentUser, deletePersistedWidget]);

  const handleTrackingVideoReady = useCallback((videoEl) => {
    if (!videoEl) return;
    videoRef.current = videoEl;
  }, []);

  const handleUnlock = useCallback(async (uuid) => {
    const positions = await loadWidgetPositions(uuid);
    setSavedWidgetPositions(positions);
    setCurrentUser(uuid);
    setLoggedIn(true);
    if (!complimentRequestedRef.current) {
      complimentRequestedRef.current = true;
      setComplimentLoopStarted(true);
      setTimeout(() => takeComplimentPhoto(), 1500);
    }
  }, [takeComplimentPhoto, loadWidgetPositions]);

  const handleLogout = useCallback(() => {
    clearTimeout(intervalRef.current);
    clearTimeout(saveTimeoutRef.current);
    setLoggedIn(false);
    setCurrentUser(null);
    setSavedWidgetPositions([]);
    setCompliment('');
    setComplimentLoopStarted(false);
    complimentRequestedRef.current = false;
    activeWidgetsRef.current = [];
  }, []);

  const handleSpawnWidget = useCallback((widgetId) => { spawnRef.current?.(widgetId); }, []);

  const handleHandPosition = useCallback((pos) => {
    const idx = pos.handIndex ?? 0;
    window.__updateHandCursor?.[idx]?.(pos);
    setHandPositions(prev => ({ ...prev, [idx]: pos }));
    setStatuses(prev => {
      const next = [...prev];
      next[idx] = { detected: pos.detected, isPinching: pos.isPinching || false, palmVisible: pos.palmVisible ?? true };
      return next;
    });
  }, []);

  return (
    <div className="index-page">
      <HandTrackingService settings={defaultSettings} enabled={true} onHandPosition={handleHandPosition} onVideoReady={handleTrackingVideoReady} />

      {!loggedIn && <LockScreen onUnlock={handleUnlock} demoMode={DEBUG} />}

      {loggedIn && (
        <>
          {DEBUG && <StatusBar statuses={statuses} />}
          {DEBUG && <LogoutButton onLogout={handleLogout} />}
          <HandNav handPositions={handPositions} onSpawnWidget={handleSpawnWidget} />
<WidgetDragManager
  key={currentUser}
  handPositions={handPositions}
  spawnRef={spawnRef}
  initialWidgets={savedWidgetPositions}
  onWidgetsChange={handleWidgetsChange}
  onWidgetRemoved={handleWidgetRemoved}
/>
          <LiveCursor handIndex={0} />
          <LiveCursor handIndex={1} />
          {compliment && (
            <div className="compliment-popup" role="status" aria-live="polite">
              <div className="card">
                <img className="img" src={notificationImage} alt="Notification" />
                <div className="textBox">
                  <div className="textContent">
                    <p className="h1">Thomas Johann Sieder</p>
                    <span className="span">now</span>
                  </div>
                  <p className="p">{compliment}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}