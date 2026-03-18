import "/src/styles/KalenderWidget.css";
import { useState, useRef, useEffect, useCallback } from "react";

const MONTH_NAMES = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function buildCells(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const offset = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(d);
  return cells;
}

export default function KalenderWidget({ handPositions = {} }) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [animate, setAnimate] = useState(null);
  const [displayDate, setDisplayDate] = useState(viewDate);
  const isAnimatingRef = useRef(false);
  const year = displayDate.getFullYear();
  const month = displayDate.getMonth();

  const goMonth = useCallback((dir) => {
    if (isAnimatingRef.current) return;
    isAnimatingRef.current = true;

    setAnimate(dir > 0 ? 'exit-left' : 'exit-right');

    setTimeout(() => {
      setViewDate((prev) => {
        const newDate = new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
        setDisplayDate(newDate);
        return newDate;
      });
      setAnimate(dir > 0 ? 'enter-right' : 'enter-left');

      setTimeout(() => {
        setAnimate(null);
        isAnimatingRef.current = false;
      }, 220);
    }, 200);
  }, []);

  const prevMonth = useCallback(() => goMonth(-1), [goMonth]);
  const nextMonth = useCallback(() => goMonth(1), [goMonth]);

  const pointerRef = useRef(null);
  const contentRef = useRef(null);

  const onPointerDown = (e) => {
    if (contentRef.current && contentRef.current.contains(e.target)) {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onPointerUp = (e) => {
    if (!pointerRef.current) return;

    if (!contentRef.current || !contentRef.current.contains(e.target)) {
      pointerRef.current = null;
      return;
    }

    const dx = e.clientX - pointerRef.current.x;
    const dy = e.clientY - pointerRef.current.y;
    pointerRef.current = null;

    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
      dx < 0 ? nextMonth() : prevMonth();
    }
  };

  const onPointerCancel = () => { pointerRef.current = null; };
  const onPointerLeave = () => { pointerRef.current = null; };

  const prevPinch = useRef({});
  const pinchStart = useRef({});
  const movedEnough = useRef({});
  const handCanSwipe = useRef({});
  const handLiveAnchor = useRef({});

  const isPointInCalendar = useCallback((x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
    if (!contentRef.current) return false;
    const hits = document.elementsFromPoint(x, y);
    return hits.some((el) => contentRef.current.contains(el));
  }, []);

  useEffect(() => {
    for (const pos of Object.values(handPositions)) {
      const { handIndex, detected, palmVisible, isPinching,
        pinchMidX, pinchMidY, x: hx, y: hy } = pos;
      const tx = hx ?? pinchMidX;
      const ty = hy ?? pinchMidY;
      const was = prevPinch.current[handIndex];

      if (!detected || palmVisible === false || !isPinching) {
        pinchStart.current[handIndex] = null;
        movedEnough.current[handIndex] = false;
        handCanSwipe.current[handIndex] = false;
        handLiveAnchor.current[handIndex] = null;
        prevPinch.current[handIndex] = false;
        continue;
      }

      if (!was && tx != null && ty != null) {
        pinchStart.current[handIndex] = { x: tx, y: ty };
        movedEnough.current[handIndex] = false;
        handCanSwipe.current[handIndex] = isPointInCalendar(tx, ty);

        if (handCanSwipe.current[handIndex]) {
          handLiveAnchor.current[handIndex] = { x: tx, y: ty };
        } else {
          handLiveAnchor.current[handIndex] = null;
        }
      }

      const startPos = pinchStart.current[handIndex];
      if (!startPos || tx == null || ty == null) {
        prevPinch.current[handIndex] = isPinching;
        continue;
      }

      if (!movedEnough.current[handIndex]) {
        const moved = Math.hypot(tx - startPos.x, ty - startPos.y);
        if (moved > 8) movedEnough.current[handIndex] = true;
      }

      if (!movedEnough.current[handIndex] || !handCanSwipe.current[handIndex]) {
        prevPinch.current[handIndex] = isPinching;
        continue; 5
      }

      const anchor = handLiveAnchor.current[handIndex] ?? startPos;
      const dx = tx - anchor.x;
      const dy = ty - anchor.y;

      if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) nextMonth();
        else prevMonth();
        handLiveAnchor.current[handIndex] = { x: tx, y: ty };
      }

      prevPinch.current[handIndex] = isPinching;
    }
  }, [handPositions, isPointInCalendar, nextMonth, prevMonth]);

  const cells = buildCells(year, month);

  const getAnimationClass = () => {
    if (!animate) return '';
    if (animate === 'exit-left') return 'kal-exit-left';
    if (animate === 'exit-right') return 'kal-exit-right';
    if (animate === 'enter-left') return 'kal-enter-left';
    if (animate === 'enter-right') return 'kal-enter-right';
    return '';
  };

  return (
    <div className="kal-widget">
      <div className="kal-header">
        <span className="kal-title">{MONTH_NAMES[month]} {year}</span>

      </div>

      <div
        className="kal-vp"
        ref={contentRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        style={{ touchAction: 'none' }}
      >
        <div className={`kal-grid-wrap ${getAnimationClass()}`}>
          <div className="kal-grid">
            {DAY_NAMES.map(d => <span key={d} className="kal-dow">{d}</span>)}
            {cells.map((d, i) => {
              const isToday = d && d === today.getDate()
                && month === today.getMonth() && year === today.getFullYear();
              return (
                <span key={i} className={`kal-day${!d ? " kal-empty" : ""}${isToday ? " kal-today" : ""}`}>
                  {d ?? ""}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}