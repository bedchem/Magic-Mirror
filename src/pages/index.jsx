import { useState, useCallback, useRef, useEffect } from 'react';
import HandTrackingService from '../components/HandTrackingService';
import WidgetDragManager from '../components/WidgetDragManager';
import notificationImage from '../assets/notification.png';

const DEBUG = true;

function useAutoBrightness(videoRef, enabled = true) {
  const valuesRef = useRef({ brightness: 1, contrast: 1, saturation: 1 });
  const frameBufferRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const INTERVAL_MS = 2000;
    const PATCH_COLS = 8;
    const PATCH_ROWS = 6;
    const PATCH_W = 8;
    const PATCH_H = 8;

    const canvas = document.createElement('canvas');
    const SAMPLE_W = PATCH_COLS * PATCH_W;
    const SAMPLE_H = PATCH_ROWS * PATCH_H;
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const measure = () => {
      const video = videoRef.current;
      if (!video || !ctx || video.readyState < 2) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      ctx.drawImage(video, 0, 0, vw, vh, 0, 0, SAMPLE_W, SAMPLE_H);
      const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

      // Reuse a preallocated luminance buffer to avoid periodic GC spikes.
      const totalPatches = PATCH_COLS * PATCH_ROWS;
      const patchLums = frameBufferRef.current && frameBufferRef.current.length === totalPatches
        ? frameBufferRef.current
        : new Float32Array(totalPatches);

      for (let row = 0; row < PATCH_ROWS; row++) {
        for (let col = 0; col < PATCH_COLS; col++) {
          let sum = 0;
          for (let py = 0; py < PATCH_H; py++) {
            const y = row * PATCH_H + py;
            const rowBase = y * SAMPLE_W;
            for (let px = 0; px < PATCH_W; px++) {
              const x = col * PATCH_W + px;
              const i = (rowBase + x) * 4;
              sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            }
          }

          const patchIndex = row * PATCH_COLS + col;
          patchLums[patchIndex] = sum / (PATCH_W * PATCH_H * 255);
        }
      }
      frameBufferRef.current = patchLums;

      const sorted = Array.from(patchLums).sort((a, b) => a - b);

      const darkCount = Math.max(1, Math.floor(sorted.length * 0.20));
      let darkSum = 0;
      for (let i = 0; i < darkCount; i++) darkSum += sorted[i];
      const darkLuminance = darkSum / darkCount;

      const brightCount = Math.max(1, Math.floor(sorted.length * 0.20));
      let brightSum = 0;
      for (let i = sorted.length - brightCount; i < sorted.length; i++) brightSum += sorted[i];
      const brightLuminance = brightSum / brightCount;

      const midLuminance = sorted[Math.floor(sorted.length / 2)];

      const highlightPenalty = brightLuminance > 0.85 ? (brightLuminance - 0.85) / 0.15 : 0;
      const shadowBoost = darkLuminance < 0.08 && midLuminance < 0.25 ? (0.08 - darkLuminance) / 0.08 : 0;
      const contrastRange = brightLuminance - darkLuminance;

      let brightness;
      if (darkLuminance < 0.04) {
        brightness = 1.6;
      } else if (darkLuminance < 0.15) {
        brightness = 1.6 - ((darkLuminance - 0.04) / 0.11) * 0.4;
      } else if (darkLuminance < 0.35) {
        brightness = 1.2 - ((darkLuminance - 0.15) / 0.20) * 0.2;
      } else if (darkLuminance < 0.55) {
        brightness = 1.0 - ((darkLuminance - 0.35) / 0.20) * 0.05;
      } else {
        brightness = 0.95;
      }

      brightness -= highlightPenalty * 0.6;
      brightness += shadowBoost * 0.3;

      if (contrastRange > 0.6) {
        brightness = 1.0 + (brightness - 1.0) * 0.2;
      }

      brightness = Math.max(0.7, Math.min(1.6, brightness));

      const contrast   = 1.0 + (brightness - 1.0) * 0.4;
      const saturation = 1.0 + (brightness - 1.0) * 0.3;

      const prev = valuesRef.current;
      const LERP = 0.3;
      const next = {
        brightness: +(prev.brightness + (brightness - prev.brightness) * LERP).toFixed(2),
        contrast:   +(prev.contrast   + (contrast   - prev.contrast)   * LERP).toFixed(2),
        saturation: +(prev.saturation + (saturation - prev.saturation) * LERP).toFixed(2),
      };

      const changed =
        next.brightness !== prev.brightness ||
        next.contrast   !== prev.contrast   ||
        next.saturation !== prev.saturation;

      if (!changed) return;

      valuesRef.current = next;

      if (video) {
        video.style.filter = `brightness(${next.brightness}) contrast(${next.contrast}) saturate(${next.saturation})`;
      }
    };

    measure();
    const id = setInterval(measure, INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, videoRef]);

  return valuesRef;
}

const baseSettings = {
  enabled: true,
  showPreview: DEBUG,
  cameraOrientation: 'landscape',
  cameraPosition: 'top',
  smoothing: 0.2,
  sensitivity: 1,
  preprocessingQuality: 'max',
  minDetectionConfidence: 0.3,
  minTrackingConfidence: 0.3,
  pinchSensitivity: 0.2,
};

const ACTIVE_COLOR = '59,130,246';
const ACTIVE_DOT = '147,197,253';
const GRAY_COLOR = '120,120,120';
const GRAY_DOT = '180,180,180';

const NAV_ITEMS = [
  {
    label: 'Datetime',
    widgetId: 'DatetimeWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    label: 'Kalender',
    widgetId: 'KalenderWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    label: 'Timer',
    widgetId: 'TimerWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
        <circle cx="12" cy="13" r="8" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 13l3-2" />
        <path d="M9 2h6" />
      </svg>
    ),
  },
  {
    label: 'Wetter',
    widgetId: 'WetterWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
        <path d="M17.5 19a4.5 4.5 0 000-9 6 6 0 10-11.7 1.5A3.5 3.5 0 006 19h11.5z" />
      </svg>
    ),
  },
  {
    label: 'Stundenplan',
    widgetId: 'StundenplanWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="8" y1="10" x2="8" y2="22" />
        <line x1="16" y1="10" x2="16" y2="22" />
      </svg>
    ),
  },
  {
    label: 'Stocks',
    widgetId: 'StocksWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 3 3 5-6" />
        <circle cx="7" cy="14" r="1" />
        <circle cx="11" cy="10" r="1" />
        <circle cx="14" cy="13" r="1" />
        <circle cx="19" cy="7" r="1" />
      </svg>
    ),
  },
  {
    label: 'News',
    widgetId: 'NewsWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="7" y1="8" x2="17" y2="8" />
        <line x1="7" y1="12" x2="17" y2="12" />
        <line x1="7" y1="16" x2="13" y2="16" />
      </svg>
    ),
  },
  {
    label: 'Zeichnen',
    widgetId: 'ZeichnenWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>
    ),
  },
  {
    label: 'Spotify',
    widgetId: 'SpotifyWidget',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="30" height="30">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
];

const MIN_INTERVAL = 3 * 60 * 1000;
const MAX_INTERVAL = 10 * 60 * 1000;

function getRandomInterval() {
  return Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;
}

function useHandPositionEmitter() {
  const listenersRef = useRef(new Set());
  const positionsRef = useRef({});

  const emit = useCallback((pos) => {
    const idx = pos.handIndex ?? 0;
    positionsRef.current = { ...positionsRef.current, [idx]: pos };
    for (const fn of listenersRef.current) fn(positionsRef.current);
  }, []);

  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  return { emit, subscribe, positionsRef };
}

function HandNav({ subscribe, onSpawnWidget }) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const plusRef = useRef(null);
  const itemRefs = useRef([]);
  const wasPinching = useRef({});
  const expandedRef = useRef(false);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    return subscribe((handPositions) => {
      const positions = Object.values(handPositions);
      if (!positions.length) return;

      const plusEl = plusRef.current;
      if (!plusEl) return;
      const plusRect = plusEl.getBoundingClientRect();

      let handOverMenu = false;
      let newHovered = null;

      for (const pos of positions) {
        if (!pos.detected || pos.palmVisible === false) continue;
        const { x, y, isPinching, handIndex } = pos;

        const MARGIN = 40;
        const overPlus =
          x >= plusRect.left - MARGIN &&
          x <= plusRect.right + MARGIN &&
          y >= plusRect.top - MARGIN &&
          y <= plusRect.bottom + MARGIN;

        if (overPlus) handOverMenu = true;

        if (expandedRef.current) {
          itemRefs.current.forEach((el, i) => {
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 10 && y <= r.bottom + 10) {
              newHovered = i;
              handOverMenu = true;
            }
          });

          if (isPinching && !wasPinching.current[handIndex] && newHovered !== null) {
            onSpawnWidget(NAV_ITEMS[newHovered].widgetId);
          }
        }

        wasPinching.current[handIndex] = isPinching;
      }

      setExpanded(handOverMenu);
      setHoveredIdx(handOverMenu ? newHovered : null);
    });
  }, [subscribe, onSpawnWidget]);

  return (
    <>
      <button
        ref={plusRef}
        onClick={() => setExpanded(v => !v)}
        className="hand-nav__toggle"
        data-expanded={expanded}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      <nav className="hand-nav__list">
        {NAV_ITEMS.map((item, i) => {
          const isHovered = hoveredIdx === i;
          const delay = `${50 + i * 60}ms`;
          return (
            <div
              key={item.label}
              ref={el => { itemRefs.current[i] = el; }}
              className="hand-nav__item"
              data-expanded={expanded}
              style={{ transitionDelay: delay }}
            >
              <button
                onClick={() => onSpawnWidget(item.widgetId)}
                className="hand-nav__btn"
                data-hovered={isHovered}
              >
                {item.icon}
              </button>
              {isHovered && (
                <span className="hand-nav__label">{item.label}</span>
              )}
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
      const el = cursorRef.current;
      const dot = dotRef.current;
      const ring = ringRef.current;
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
      ring.style.width = `${size}px`;
      ring.style.height = `${size}px`;
      ring.style.borderColor = `rgba(${rc},${isPinching ? 0.8 + s * 0.2 : 0.75})`;
      ring.style.boxShadow = palmOk
        ? `0 0 ${20 + s * 20}px rgba(${rc},${0.6 + s * 0.3}), 0 0 ${40 + s * 40}px rgba(${rc},${0.3 + s * 0.2})`
        : 'none';
      ring.style.borderWidth = `${isPinching ? 3 + s * 2 : 3}px`;
      ring.style.background = `rgba(${rc},${palmOk ? 0.12 : 0.06})`;

      const dotSize = palmOk ? 4 + s * 4 : 3;
      dot.style.width = `${dotSize}px`;
      dot.style.height = `${dotSize}px`;
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

function StatusBar({ subscribe, exposureRef }) {
  const [statuses, setStatuses] = useState([
    { detected: false, isPinching: false, palmVisible: false },
    { detected: false, isPinching: false, palmVisible: false },
  ]);
  const [display, setDisplay] = useState({ brightness: 1, contrast: 1, saturation: 1 });

  useEffect(() => {
    const id = setInterval(() => {
      setDisplay(prev => {
        const next = exposureRef.current;
        if (
          prev.brightness === next.brightness &&
          prev.contrast === next.contrast &&
          prev.saturation === next.saturation
        ) {
          return prev;
        }
        return { ...next };
      });
    }, 2000);
    return () => clearInterval(id);
  }, [exposureRef]);

  useEffect(() => {
    let rafId;
    return subscribe((handPositions) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setStatuses(prev => {
          const next = [...prev];
          let changed = false;
          for (const pos of Object.values(handPositions)) {
            const idx = pos.handIndex ?? 0;
            const s = {
              detected: pos.detected,
              isPinching: pos.isPinching || false,
              palmVisible: pos.palmVisible ?? true,
            };
            if (
              next[idx]?.detected !== s.detected ||
              next[idx]?.isPinching !== s.isPinching ||
              next[idx]?.palmVisible !== s.palmVisible
            ) {
              next[idx] = s;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      });
    });
  }, [subscribe]);

  return (
    <div className="status-bar">
      {statuses.map((s, i) => <HandStatusDot key={i} status={s} index={i} />)}
      {DEBUG && (
        <div className="status-bar__entry">
          <div className="status-bar__dot" style={{ background: '#a78bfa', boxShadow: '0 0 8px #a78bfa' }} />
          <span className="status-bar__label">
            b{display.brightness}× c{display.contrast}× s{display.saturation}×
          </span>
        </div>
      )}
    </div>
  );
}

export default function IndexPage() {
  const [compliment, setCompliment] = useState('');
  const [complimentLoopStarted, setComplimentLoopStarted] = useState(false);
  const videoRef = useRef(null);
  const complimentRequestedRef = useRef(false);
  const intervalRef = useRef(null);
  const spawnRef = useRef(null);

  const exposureRef = useAutoBrightness(videoRef, true);
  const { emit, subscribe, positionsRef } = useHandPositionEmitter();

  const takeComplimentPhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);

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
        } catch (e) {
          console.error('Compliment fetch error:', e);
        }
      }, 'image/jpeg', 0.9);
    } catch (e) {
      console.error('Canvas error:', e);
    }
  }, []);

  useEffect(() => {
    if (!complimentLoopStarted) return;

    const scheduleNext = () => {
      const interval = getRandomInterval();
      intervalRef.current = setTimeout(async () => {
        await takeComplimentPhoto();
        scheduleNext();
      }, interval);
    };

    scheduleNext();
    return () => clearTimeout(intervalRef.current);
  }, [complimentLoopStarted, takeComplimentPhoto]);

  const handleTrackingVideoReady = useCallback((videoEl) => {
    if (!videoEl) return;
    videoRef.current = videoEl;

    if (!complimentRequestedRef.current) {
      complimentRequestedRef.current = true;
      setComplimentLoopStarted(true);
      setTimeout(() => takeComplimentPhoto(), 1500);
    }
  }, [takeComplimentPhoto]);

  const handleSpawnWidget = useCallback((widgetId) => {
    spawnRef.current?.(widgetId);
  }, []);

  const handleHandPosition = useCallback((pos) => {
    const idx = pos.handIndex ?? 0;
    window.__updateHandCursor?.[idx]?.(pos);
    emit(pos);
  }, [emit]);

  return (
    <div className="index-page">
      {DEBUG && <StatusBar subscribe={subscribe} exposureRef={exposureRef} />}

      <HandTrackingService
        settings={baseSettings}
        enabled={true}
        onHandPosition={handleHandPosition}
        onVideoReady={handleTrackingVideoReady}
      />

      <HandNav
        subscribe={subscribe}
        onSpawnWidget={handleSpawnWidget}
      />

      <WidgetDragManager
        positionsRef={positionsRef}
        subscribe={subscribe}
        spawnRef={spawnRef}
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
    </div>
  );
}