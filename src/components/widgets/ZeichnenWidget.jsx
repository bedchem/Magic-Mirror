import { useRef, useState, useEffect, useCallback } from 'react';
import '/src/styles/ZeichnenWidget.css';

const PenIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3L21 7L7 21H3V17L17 3Z" />
    <path d="M15 5L19 9" />
  </svg>
);

const EraserIcon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 14L14 4C15.1 2.9 16.9 2.9 18 4L20 6C21.1 7.1 21.1 8.9 20 10L10 20H6C4.9 20 4 19.1 4 18V14Z" />

  </svg>
);

export default function ZeichnenWidget({ handPositions = {} }) {
  const canvasRef = useRef(null);
  const sliderRef = useRef(null);
  const [mode, setMode] = useState('draw');
  const [lineWidth, setLineWidth] = useState(4);
  const [drawColor, setDrawColor] = useState('#ffffff');
  const lastPosRef = useRef(null);
  const ctxRef = useRef(null);
  const sliderHandRef = useRef(null);
  const MIN_LINE_WIDTH = 1;
  const MAX_LINE_WIDTH = 20;
  const COLORS = ['#ffffff', '#ff5f56', '#ffd166', '#06d6a0', '#4cc9f0', '#7b61ff', '#ff66c4', '#1f2937'];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx) ctx.lineWidth = lineWidth;
  }, [lineWidth]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getCanvasCoords = useCallback((screenX, screenY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (
      screenX < rect.left || screenX > rect.right ||
      screenY < rect.top || screenY > rect.bottom
    ) {
      return null;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (screenX - rect.left) * scaleX,
      y: (screenY - rect.top) * scaleY,
    };
  }, []);

  const getSliderValueFromScreen = useCallback((screenX, screenY, loose = false) => {
    const slider = sliderRef.current;
    if (!slider) return null;

    const rect = slider.getBoundingClientRect();
    const yPadding = loose ? 28 : 0;
    const xPadding = loose ? 20 : 0;

    if (
      screenX < rect.left - xPadding || screenX > rect.right + xPadding ||
      screenY < rect.top - yPadding || screenY > rect.bottom + yPadding
    ) {
      return null;
    }

    const ratio = Math.min(1, Math.max(0, (screenX - rect.left) / rect.width));
    const value = MIN_LINE_WIDTH + ratio * (MAX_LINE_WIDTH - MIN_LINE_WIDTH);
    return Math.round(value);
  }, [MAX_LINE_WIDTH, MIN_LINE_WIDTH]);

  const drawLine = useCallback((fromX, fromY, toX, toY) => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    if (mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = drawColor;
    }

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  }, [mode, drawColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const pinchHands = Object.entries(handPositions)
      .filter(([, pos]) => pos.detected && pos.palmVisible && pos.isPinching);

    let sliderControlled = false;

    if (sliderHandRef.current) {
      const lockedHand = pinchHands.find(([handId]) => handId === sliderHandRef.current);
      if (lockedHand) {
        const [, pos] = lockedHand;
        const sliderValue = getSliderValueFromScreen(pos.x, pos.y, true);
        if (sliderValue !== null) {
          sliderControlled = true;
          setLineWidth((prev) => (prev === sliderValue ? prev : sliderValue));
        }
      }
    }

    if (!sliderControlled) {
      sliderHandRef.current = null;
      for (const [handId, pos] of pinchHands) {
        const sliderValue = getSliderValueFromScreen(pos.x, pos.y);
        if (sliderValue !== null) {
          sliderControlled = true;
          sliderHandRef.current = handId;
          setLineWidth((prev) => (prev === sliderValue ? prev : sliderValue));
          break;
        }
      }
    }

    if (sliderControlled) {
      lastPosRef.current = null;
      return;
    }

    sliderHandRef.current = null;

    let activeHand = null;
    for (const [, pos] of pinchHands) {
      if (pos.detected && pos.palmVisible && pos.isPinching) {
        const coords = getCanvasCoords(pos.x, pos.y);
        if (coords) {
          activeHand = { ...pos, canvasX: coords.x, canvasY: coords.y };
          break;
        }
      }
    }

    if (activeHand) {
      const { canvasX, canvasY } = activeHand;

      if (lastPosRef.current) {
        drawLine(
          lastPosRef.current.x,
          lastPosRef.current.y,
          canvasX,
          canvasY
        );
      }

      lastPosRef.current = { x: canvasX, y: canvasY };
    } else {
      lastPosRef.current = null;
    }
  }, [handPositions, getCanvasCoords, drawLine, getSliderValueFromScreen]);

  return (
    <div className="zeichnen-widget">
      <div className="zeichnen-toolbar">
        <div className="zeichnen-slider-container">
          <input
            ref={sliderRef}
            type="range"
            min={MIN_LINE_WIDTH}
            max={MAX_LINE_WIDTH}
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
            className="zeichnen-slider"
          />
          <span className="zeichnen-slider-value">{lineWidth}</span>
        </div>
        <div className="zeichnen-toolbar-buttons">
          <button
            className={`zeichnen-btn ${mode === 'draw' ? 'active' : ''}`}
            onClick={() => setMode('draw')}
            title="Stift"
          >
            <PenIcon />
          </button>
          <button
            className={`zeichnen-btn ${mode === 'erase' ? 'active' : ''}`}
            onClick={() => setMode('erase')}
            title="Radierer"
          >
            <EraserIcon />
          </button>
          <button
            className="zeichnen-btn"
            onClick={clearCanvas}
            title="Alles löschen"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6H21" />
              <path d="M19 6V20H5V6" />
              <path d="M8 4V6" />
              <path d="M16 4V6" />
              <path d="M10 11V16" />
              <path d="M14 11V16" />
            </svg>
          </button>
        </div>
      </div>
      <div className="zeichnen-content">
        <canvas
          ref={canvasRef}
          width={600}
          height={450}
          className="zeichnen-canvas"
        />
        <div className="zeichnen-colors" aria-label="Farbauswahl">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`zeichnen-color-btn ${drawColor === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => {
                setMode('draw');
                setDrawColor(color);
              }}
              title={`Farbe ${color}`}
              aria-label={`Farbe ${color}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}