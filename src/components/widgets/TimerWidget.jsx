import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import '/src/styles/TimerWidget.css';

const pad = n => String(n).padStart(2, '0');
const IH = 40;
const VIS = 5;
const CX = Math.floor(VIS / 2);
const CIRC = 2 * Math.PI * 140;

function DrumConnected({ value, onChange, max, label, drumIndex, drumRefs }) {
  const vpRef = useRef(null);
  const innerRef = useRef(null);
  const S = useRef({ offset: 0, val: 0, raf: null });
  const drag = useRef(null);

  const apply = useCallback((y) => {
    const c = Math.max(-(max * IH), Math.min(0, y));
    S.current.offset = c;
    if (!innerRef.current) return;
    innerRef.current.style.transform = `translateY(${c + CX * IH}px)`;
    const idx = Math.round(-c / IH);
    S.current.val = Math.max(0, Math.min(max, idx));
    Array.from(innerRef.current.children).forEach((el, i) => {
      const d = Math.abs(i - idx);
      el.className = 't-drum-item' + (d === 0 ? ' sel' : d === 1 ? ' near' : '');
    });
  }, [max]);

  const snap = useCallback(() => {
    const target = Math.max(-(max * IH), Math.min(0, Math.round(S.current.offset / IH) * IH));
    cancelAnimationFrame(S.current.raf);
    const go = () => {
      const diff = target - S.current.offset;
      if (Math.abs(diff) < 0.4) { apply(target); onChange(S.current.val); return; }
      apply(S.current.offset + diff * 0.28);
      onChange(S.current.val);
      S.current.raf = requestAnimationFrame(go);
    };
    S.current.raf = requestAnimationFrame(go);
  }, [max, apply, onChange]);

  useEffect(() => {
    drumRefs[drumIndex].scroll = (deltaY) => {
      cancelAnimationFrame(S.current.raf);
      if (!drag.current || drag.current.source !== 'hand') {
        drag.current = { source: 'hand', so: S.current.offset, accumulated: 0 };
      }
      drag.current.accumulated += deltaY;
      apply(drag.current.so + drag.current.accumulated);
      onChange(S.current.val);
    };
    drumRefs[drumIndex].snap = () => {
      if (drag.current?.source === 'hand') drag.current = null;
      snap();
    };
  }, [drumIndex, drumRefs, apply, snap, onChange]);

  useEffect(() => {
    if (!drag.current || drag.current.source === 'hand') apply(-value * IH);
  }, [value, apply]);

  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    let vel = 0;

    const down = e => {
      e.preventDefault();
      cancelAnimationFrame(S.current.raf);
      drag.current = { source: 'pointer', sy: e.clientY, so: S.current.offset, ly: e.clientY, lt: Date.now() };
      vel = 0;
      vp.setPointerCapture(e.pointerId);
    };
    const move = e => {
      if (!drag.current || drag.current.source !== 'pointer') return;
      const now = Date.now(), dt = now - drag.current.lt;
      if (dt > 0) vel = (e.clientY - drag.current.ly) / dt;
      drag.current.ly = e.clientY; drag.current.lt = now;
      apply(drag.current.so + (e.clientY - drag.current.sy));
      onChange(S.current.val);
    };
    const up = () => {
      if (!drag.current || drag.current.source !== 'pointer') return;
      drag.current = null;
      let momentum = vel * 90, p = S.current.offset;
      const min = -(max * IH);
      cancelAnimationFrame(S.current.raf);
      const coast = () => {
        momentum *= 0.84; p = Math.max(min, Math.min(0, p + momentum));
        apply(p); onChange(S.current.val);
        if (Math.abs(momentum) > 0.4) S.current.raf = requestAnimationFrame(coast);
        else snap();
      };
      S.current.raf = requestAnimationFrame(coast);
    };

    vp.addEventListener('pointerdown', down);
    vp.addEventListener('pointermove', move);
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
    return () => {
      vp.removeEventListener('pointerdown', down);
      vp.removeEventListener('pointermove', move);
      vp.removeEventListener('pointerup', up);
      vp.removeEventListener('pointercancel', up);
    };
  }, [max, apply, snap, onChange]);

  useEffect(() => () => cancelAnimationFrame(S.current.raf), []);

  return (
    <div className="t-drum-col hand-drum-target" data-drum-index={drumIndex}>
      <div className="t-drum-vp" ref={vpRef}>
        <div className="t-drum-inner" ref={innerRef}>
          {Array.from({ length: max + 1 }, (_, i) => (
            <div key={i} className="t-drum-item">{pad(i)}</div>
          ))}
        </div>
        <div className="t-fade-top" />
        <div className="t-fade-bot" />
      </div>
      <span className="t-drum-label">{label}</span>
    </div>
  );
}

function useHandTracking(handPositions, drumRefs, screen, onPinchButton) {
  const prevY = useRef({});
  const activeDrum = useRef({});
  const wasPinch = useRef({});
  const pinchStart = useRef({});
  const movedEnough = useRef({});

  const findDrumAt = useCallback((x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
    const els = document.elementsFromPoint(x, y);

    for (const el of els) {
      if (el.hasAttribute?.('data-drum-index')) {
        const idx = parseInt(el.getAttribute('data-drum-index'), 10);
        if (Number.isInteger(idx)) return idx;
      }
      const parentDrum = el.closest?.('[data-drum-index]');
      if (parentDrum) {
        const idx = parseInt(parentDrum.getAttribute('data-drum-index'), 10);
        if (Number.isInteger(idx)) return idx;
      }
    }

    return null;
  }, []);

  useEffect(() => {
    for (const pos of Object.values(handPositions)) {
      const { handIndex, detected, palmVisible, isPinching, pinchMidX, pinchMidY, x: hx, y: hy } = pos;
      const tx = hx ?? pinchMidX;
      const ty = hy ?? pinchMidY;

      if (!detected || palmVisible === false || !isPinching) {
        if (activeDrum.current[handIndex] != null) {
          drumRefs[activeDrum.current[handIndex]]?.snap?.();
          activeDrum.current[handIndex] = null;
        }
        prevY.current[handIndex] = null;
        pinchStart.current[handIndex] = null;
        movedEnough.current[handIndex] = false;
        wasPinch.current[handIndex] = false;
        continue;
      }

      if (!wasPinch.current[handIndex]) {
        pinchStart.current[handIndex] = { tx, ty };
        movedEnough.current[handIndex] = false;
        wasPinch.current[handIndex] = true;
      }

      const startPos = pinchStart.current[handIndex];
      const immediateDrumIdx =
        findDrumAt(startPos?.tx, startPos?.ty) ??
        findDrumAt(tx, ty);

      if (activeDrum.current[handIndex] == null && Number.isInteger(immediateDrumIdx)) {
        activeDrum.current[handIndex] = immediateDrumIdx;
        prevY.current[handIndex] = ty;
      }

      if (startPos && !movedEnough.current[handIndex]) {
        const moved = Math.abs(ty - startPos.ty);
        if (moved > 8 || activeDrum.current[handIndex] != null) {
          movedEnough.current[handIndex] = true;
        }
      }

      if (!movedEnough.current[handIndex]) {
        continue;
      }

      if (screen === 'set') {
        if (activeDrum.current[handIndex] == null) {
          const foundDrumIdx =
            findDrumAt(startPos?.tx, startPos?.ty) ??
            findDrumAt(tx, ty);

          if (Number.isInteger(foundDrumIdx)) {
            activeDrum.current[handIndex] = foundDrumIdx;
            prevY.current[handIndex] = ty;
          }
        }

        if (activeDrum.current[handIndex] != null) {
          const liveDrumIdx = findDrumAt(tx, ty);

          if (liveDrumIdx !== activeDrum.current[handIndex]) {
            drumRefs[activeDrum.current[handIndex]]?.snap?.();
            activeDrum.current[handIndex] = null;
            prevY.current[handIndex] = null;
            continue;
          }

          const py = prevY.current[handIndex];
          if (py != null) {
            const delta = ty - py;
            if (Math.abs(delta) > 0.8) drumRefs[activeDrum.current[handIndex]]?.scroll?.(delta);
          }
          prevY.current[handIndex] = ty;
        }
      }
    }

    for (const pos of Object.values(handPositions)) {
      const { handIndex, detected, palmVisible, isPinching, pinchMidX, pinchMidY, x: hx, y: hy } = pos;
      const tx = hx ?? pinchMidX;
      const ty = hy ?? pinchMidY;

      if (!detected || palmVisible === false) continue;

      const prevWas = wasPinch.current[handIndex];
      if (isPinching && !prevWas) {
        const startPos = pinchStart.current[handIndex];
        if (startPos && !movedEnough.current[handIndex]) {
          onPinchButton(startPos.tx, startPos.ty, handIndex);
        }
      }
    }
  }, [handPositions, drumRefs, screen, onPinchButton, findDrumAt]);
}

export default function TimerWidget({ handPositions = {} }) {
  const [screen, setScreen] = useState('set');
  const [exiting, setExiting] = useState(false);
  const [h, setH] = useState(0);
  const [m, setM] = useState(0);
  const [s, setS] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const endRef = useRef(null);
  const pausedRef = useRef(0);
  const rafRef = useRef(null);
  const drum0 = useRef({ scroll: null, snap: null });
  const drum1 = useRef({ scroll: null, snap: null });
  const drum2 = useRef({ scroll: null, snap: null });
  
  const drumRefs = useMemo(() => [drum0.current, drum1.current, drum2.current], []);

  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  const totalMs = (h * 3600 + m * 60 + s) * 1000;

  const tick = useCallback(() => {
    const left = Math.max(0, endRef.current - Date.now());
    setRemaining(left);
    if (left <= 0) { setRunning(false); setDone(true); return; }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const transition = to => {
    setExiting(true);
    setTimeout(() => { setScreen(to); setExiting(false); }, 350);
  };

  const startTimer = useCallback(() => {
    const ms = (drum0.current._val ?? 0) * 3600000
      + (drum1.current._val ?? 0) * 60000
      + (drum2.current._val ?? 0) * 1000;
    if (ms <= 0) return;
    setTotal(ms); setRemaining(ms);
    endRef.current = Date.now() + ms;
    pausedRef.current = 0;
    setRunning(true); setDone(false);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    setExiting(true);
    setTimeout(() => { setScreen('run'); setExiting(false); }, 350);
  }, [tick]);

  const cancel = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false); setDone(false); setRemaining(0);
    pausedRef.current = 0;
    setExiting(true);
    setTimeout(() => { setScreen('set'); setExiting(false); }, 350);
  }, []);

  const pauseResume = useCallback(() => {
    setDone(prev => {
      if (prev) {
        setRunning(true);
        endRef.current = Date.now() + total;
        setRemaining(total);
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(tick);
        return false;
      }
      return prev;
    });
    setRunning(prev => {
      if (prev) {
        cancelAnimationFrame(rafRef.current);
        pausedRef.current = Math.max(0, endRef.current - Date.now());
        setRemaining(pausedRef.current);
        return false;
      } else {
        if (pausedRef.current <= 0) return false;
        endRef.current = Date.now() + pausedRef.current;
        pausedRef.current = 0;
        rafRef.current = requestAnimationFrame(tick);
        return true;
      }
    });
  }, [tick, total]);

  const onPinchButton = useCallback((tx, ty) => {
    const els = document.elementsFromPoint(tx, ty);
    const btn = els.find(el => el.tagName === 'BUTTON' || el.closest?.('button'));
    const target = btn?.closest?.('button') ?? btn;
    if (target) {
      target.classList.add('hand-active');
      setTimeout(() => target.classList.remove('hand-active'), 150);
      target.click();
    }
  }, []);

  useHandTracking(handPositions, drumRefs, screen, onPinchButton);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const pct = total > 0 ? Math.max(0, remaining / total) : 0;
  const isLow = pct < 0.2 && total > 0;
  const dH = Math.floor(remaining / 3600000);
  const dM = Math.floor((remaining % 3600000) / 60000);
  const dS = Math.floor((remaining % 60000) / 1000);
  const timeStr = dH > 0 ? `${pad(dH)}:${pad(dM)}:${pad(dS)}` : `${pad(dM)}:${pad(dS)}`;

  const setClass = `t-screen${screen === 'set' ? (exiting ? ' off' : ' on') : ''}`;
  const runClass = `t-screen t-ring-screen${screen === 'run' ? (exiting ? ' off' : ' on') : ''}`;

  const onDrumChange = (setter, drumRef) => (val) => {
    setter(val);
    drumRef.current._val = val;
  };

  return (
    <div className="t-app">
      <div className={setClass}>

        <div className="t-picker">
          <div className="t-picker-hl" />
          <div className="t-drums">
            <DrumConnected value={h} onChange={onDrumChange(setH, drum0)} max={23} label="Stunden" drumIndex={0} drumRefs={drumRefs} />
            <span className="t-drum-sep">:</span>
            <DrumConnected value={m} onChange={onDrumChange(setM, drum1)} max={59} label="Minuten" drumIndex={1} drumRefs={drumRefs} />
            <span className="t-drum-sep">:</span>
            <DrumConnected value={s} onChange={onDrumChange(setS, drum2)} max={59} label="Sekunden" drumIndex={2} drumRefs={drumRefs} />
          </div>
        </div>
          <div className="t-bar">
          <button className="t-bar-start" onClick={startTimer} disabled={totalMs <= 0}>Start</button>
        </div>
      </div>

      <div className={runClass}>
        <div className="t-bar">
          <span style={{ width: 80 }} />
          <span className="t-bar-title">Timer</span>
          <span style={{ width: 80 }} />
        </div>
        <div className="t-ring-area">
          <svg width="320" height="320" viewBox="0 0 320 320">
            <circle cx="160" cy="160" r="140" fill="none" stroke="#1a1a1a" strokeWidth="9" />
            <circle
              cx="160" cy="160" r="140" fill="none"
              stroke={isLow ? '#ff453a' : '#0a84ff'}
              strokeWidth="9" strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - pct)}
              transform="rotate(-90 160 160)"
              className="t-arc"
            />
            <text x="160" y="175" textAnchor="middle" className="t-ring-time">{timeStr}</text>
          </svg>
        </div>
        {done && <div className="t-done-label">Zeit abgelaufen!</div>}
        <div className="t-btns">
          <button className="t-btn t-btn-cancel" onClick={cancel}>Abbr.</button>
          <button
            className={`t-btn ${done ? 't-btn-resume' : running ? 't-btn-pause' : 't-btn-resume'}`}
            onClick={pauseResume}
          >
            {done ? 'Neu' : running ? 'Pause' : 'Weiter'}
          </button>
        </div>
      </div>
    </div>
  );
}