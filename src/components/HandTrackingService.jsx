import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import {
  CAMERA_ORIENTATION_ROTATIONS,
  CAMERA_POSITION_ROTATIONS,
  getExposureFilterString,
  getHandTrackingRuntimeConfig,
  preprocessVideoFrame,
  transformHandCoordinates,
} from '../utils/handTracking';

const clampVal = (v, min, max, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fb;
};
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const FPS_SMOOTH = 0.9;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17],
];

const LABEL_TO_SLOT = { Left: 0, Right: 1 };

function isPalmFacingCamera(landmarks, handLabel) {
  const wrist = landmarks[0];
  const indexMCP = landmarks[5];
  const pinkyMCP = landmarks[17];
  const v1 = { x: indexMCP.x - wrist.x, y: indexMCP.y - wrist.y };
  const v2 = { x: pinkyMCP.x - wrist.x, y: pinkyMCP.y - wrist.y };
  const normalZ = v1.x * v2.y - v1.y * v2.x;
  return handLabel === 'Right' ? normalZ > 0 : normalZ < 0;
}

const HandTrackingService = ({ onHandPosition, onGesture, settings = {}, enabled }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const procCanvasRef = useRef(null);
  const procCtxRef = useRef(null);
  const settingsRef = useRef(settings);
  const posCallbackRef = useRef(onHandPosition);
  const gestureCallbackRef = useRef(onGesture);
  const showPreviewRef = useRef(settings.showPreview || false);
  const isProcessingRef = useRef(false);
  const smoothedRef = useRef({});
  const smoothingRef = useRef(0);
  const sensitivityRef = useRef(1);
  const cameraRef = useRef(null);
  const handsRef = useRef(null);
  const fpsRef = useRef({ value: 0, last: performance?.now?.() ?? Date.now() });

  const [previewPos, setPreviewPos] = useState({ x: 16, y: 16 });
  const [dragging, setDragging] = useState(false);
  const [dragOrigin, setDragOrigin] = useState({ x: 0, y: 0 });

  const isEnabled = enabled ?? settings.enabled ?? false;
  const showPreview = settings.showPreview || false;
  const orientRot = CAMERA_ORIENTATION_ROTATIONS[settings.cameraOrientation || 'landscape'] ?? 0;
  const camRot = CAMERA_POSITION_ROTATIONS[settings.cameraPosition || 'top'] ?? 0;

  useEffect(() => {
    settingsRef.current = settings;
    showPreviewRef.current = settings.showPreview || false;
    smoothingRef.current = clampVal(settings.smoothing, 0, 0.95, 0);
    sensitivityRef.current = clampVal(settings.sensitivity, 0.25, 3, 1);
  }, [settings]);

  useEffect(() => { posCallbackRef.current = onHandPosition; }, [onHandPosition]);
  useEffect(() => { gestureCallbackRef.current = onGesture; }, [onGesture]);
  useEffect(() => () => {
    posCallbackRef.current = null;
    gestureCallbackRef.current = null;
  }, []);

  const onResults = useCallback((results) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width = video.videoWidth;
    const h = canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, w, h);

    const s = settingsRef.current || {};

    const nowTs = performance?.now?.() ?? Date.now();
    const elapsed = nowTs - fpsRef.current.last;
    fpsRef.current.last = nowTs;
    fpsRef.current.value = FPS_SMOOTH * fpsRef.current.value +
      (1 - FPS_SMOOTH) * (elapsed > 0 ? 1000 / elapsed : 0);

    if (showPreviewRef.current) {
      ctx.save();
      ctx.translate(w, 0); ctx.scale(-1, 1);
      ctx.filter = getExposureFilterString(s);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(10, 10, 92, 28);
      ctx.fillStyle = '#fff';
      ctx.font = '14px "Segoe UI",Arial,sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`FPS: ${fpsRef.current.value.toFixed(1)}`, 18, 24);
      ctx.restore();
    }

    const allHands = results.multiHandLandmarks || [];
    const allLabels = results.multiHandedness || [];

    const seenLabels = new Set();
    const dedupedHands = [];
    allHands.forEach((hand, i) => {
      const label = allLabels[i]?.label || 'Left';
      if (!seenLabels.has(label)) {
        seenLabels.add(label);
        dedupedHands.push({ hand, label });
      }
    });

    const activeSlots = new Set();

    if (dedupedHands.length === 0) {
      smoothedRef.current = {};
      posCallbackRef.current?.({ detected: false, handIndex: 0 });
      posCallbackRef.current?.({ detected: false, handIndex: 1 });
      return;
    }

    for (const { hand, label } of dedupedHands) {
      const slot = LABEL_TO_SLOT[label] ?? 0;
      const palmVisible = isPalmFacingCamera(hand, label);
      activeSlots.add(slot);

      if (showPreviewRef.current) {
        const mirrored = hand.map(lm => ({ ...lm, x: 1 - lm.x }));
        const lineColor = palmVisible ? '#00ff00' : '#888888';
        const dotColor = palmVisible ? '#ff0000' : '#555555';
        drawConnectors(ctx, mirrored, HAND_CONNECTIONS, { color: lineColor, lineWidth: 2 });
        drawLandmarks(ctx, mirrored, { color: dotColor, lineWidth: 1 });
        const mWrist = mirrored[0];
        ctx.save();
        ctx.fillStyle = lineColor;
        ctx.font = 'bold 11px "Segoe UI",Arial,sans-serif';
        ctx.fillText(
          palmVisible ? `Palm (${label})` : `Back (${label})`,
          mWrist.x * w, mWrist.y * h - 10
        );
        ctx.restore();
      }

      if (!palmVisible) {
        posCallbackRef.current?.({
          detected: true,
          palmVisible: false,
          handIndex: slot,
          x: smoothedRef.current[slot]
            ? smoothedRef.current[slot].x * window.innerWidth
            : window.innerWidth / 2,
          y: smoothedRef.current[slot]
            ? smoothedRef.current[slot].y * window.innerHeight
            : window.innerHeight / 2,
        });
        continue;
      }

      const thumb = hand[4], index = hand[8], middle = hand[12], pinky = hand[20];
      if (!thumb || !index || !middle || !pinky) continue;

      let total = 0, count = 0;
      for (const [a, b] of HAND_CONNECTIONS) {
        if (!hand[a] || !hand[b]) continue;
        total += Math.hypot((hand[a].x - hand[b].x) * w, (hand[a].y - hand[b].y) * h);
        count++;
      }
      const al = count > 0 ? total / count : 1;
      if (!al || !isFinite(al) || al <= 0) continue;

      const tx = thumb.x * w, ty = thumb.y * h;
      const ix = index.x * w, iy = index.y * h;
      const mdx = middle.x * w, mdy = middle.y * h;
      const pkx = pinky.x * w, pky = pinky.y * h;

      const pinchDist = Math.hypot(tx - ix, ty - iy);
      const clickDist = Math.hypot(tx - mdx, ty - mdy);
      const pinkyDist = Math.hypot(tx - pkx, ty - pky);
      const pinchThr = s.pinchSensitivity || 0.2;
      const normPinch = clamp01(pinchDist / (al * 4.5));
      const scaledThr = al * 4.5 * pinchThr;
      const pinchStr = scaledThr > 0 ? Math.max(0, 1 - pinchDist / scaledThr) : 0;
      const isPinching = pinchDist < scaledThr;
      const clickStr = scaledThr > 0 ? Math.max(0, 1 - clickDist / scaledThr) : 0;
      const isClicking = clickDist < scaledThr;

      const fistThr = s.fistThreshold || 0.35;
      const openThr = Math.max(s.openThreshold || 0.65, fistThr + 0.1);
      const normPinky = al ? pinkyDist / al : 0;
      const isFist = normPinky <= fistThr;
      const isHandOpen = normPinky >= openThr;

      const mcpIndex = hand[5];
      const mcpMiddle = hand[9];
      const mcpRing = hand[13];
      const mcpPinky = hand[17];
      if (!mcpIndex || !mcpMiddle || !mcpRing || !mcpPinky) continue;

      const mcpX = (mcpIndex.x + mcpMiddle.x + mcpRing.x + mcpPinky.x) / 4;
      const mcpY = (mcpIndex.y + mcpMiddle.y + mcpRing.y + mcpPinky.y) / 4;

      const fmx = (thumb.x + index.x) / 2;
      const fmy = (thumb.y + index.y) / 2;

      const BLEND = 0.4;
      const mx = mcpX + (fmx - mcpX) * BLEND;
      const my = mcpY + (fmy - mcpY) * BLEND;

      const pinchMidX = fmx * window.innerWidth;
      const pinchMidY = fmy * window.innerHeight;

      const { x: nx, y: ny } = transformHandCoordinates(
        mx, my, s.cameraOrientation || 'landscape', s.cameraPosition || 'top'
      );

      const margin = clamp01(s.cameraMargin ?? 0.15);
      const remap = (v) => clamp01((v - margin) / (1 - 2 * margin));
      const remapX = remap(nx);
      const remapY = remap(ny);

      const sens = sensitivityRef.current;
      const ax = clamp01(((remapX - 0.5) * sens) + 0.5);
      const ay = clamp01(((remapY - 0.5) * sens) + 0.5);

      const sm = smoothingRef.current;
      const prev = smoothedRef.current[slot];
      let sx = ax, sy = ay;

      if (prev) {
        const moveDist = Math.hypot(ax - prev.x, ay - prev.y);
        const deadzone = 0.008 / Math.max(sensitivityRef.current, 0.25);

        if (moveDist < deadzone) {
          sx = prev.x;
          sy = prev.y;
        } else if (sm > 0) {
          const effectiveSm = isPinching ? Math.min(sm + 0.12, 0.92) : sm;
          const adaptiveSm = moveDist > 0.06 ? Math.max(effectiveSm - 0.15, 0) : effectiveSm;
          const alpha = 1 - adaptiveSm;
          sx = prev.x + (ax - prev.x) * alpha;
          sy = prev.y + (ay - prev.y) * alpha;
        }
      }
      smoothedRef.current[slot] = { x: sx, y: sy };

      posCallbackRef.current?.({
        x: sx * window.innerWidth,
        y: sy * window.innerHeight,
        detected: true,
        palmVisible: true,
        isPinching,
        pinchStrength: Math.min(pinchStr, 1),
        pinchDistance: normPinch,
        isClicking,
        clickStrength: Math.min(clickStr, 1),
        isFist,
        fistStrength: clamp01(1 - normPinky / fistThr),
        isHandOpen,
        pinkyThumbDistanceRatio: normPinky,
        handedness: label.toLowerCase(),
        handIndex: slot,
        handSize: al,
        pinchMidX,
        pinchMidY,
      });

      if (showPreviewRef.current) {
        const mirrored = hand.map(lm => ({ ...lm, x: 1 - lm.x }));
        const mTX = mirrored[4].x * w, mTY = mirrored[4].y * h;
        const mIX = mirrored[8].x * w, mIY = mirrored[8].y * h;
        const mMDX = mirrored[12].x * w, mMDY = mirrored[12].y * h;
        const midX = (mTX + mIX) / 2, midY = (mTY + mIY) / 2;
        const handRatio = al / w;
        const dotR = Math.max(0.8, w * handRatio * 0.07);
        const midR = Math.max(1, w * handRatio * (isPinching ? 0.11 : 0.08));
        ctx.beginPath(); ctx.arc(mTX, mTY, dotR, 0, 2 * Math.PI);
        ctx.fillStyle = '#FF00FF'; ctx.fill();
        ctx.beginPath(); ctx.arc(mIX, mIY, dotR, 0, 2 * Math.PI);
        ctx.fillStyle = '#00FF88'; ctx.fill();
        ctx.beginPath(); ctx.arc(mMDX, mMDY, dotR, 0, 2 * Math.PI);
        ctx.fillStyle = '#FFD700'; ctx.fill();
        ctx.beginPath();
        ctx.arc(midX, midY, midR, 0, 2 * Math.PI);
        ctx.globalAlpha = isPinching ? 0.9 : 0.6;
        ctx.fillStyle = isPinching ? '#ffffff' : '#00FFFF';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    for (let slot = 0; slot < 2; slot++) {
      if (!activeSlots.has(slot)) {
        smoothedRef.current[slot] = null;
        posCallbackRef.current?.({ detected: false, handIndex: slot });
      }
    }
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      cameraRef.current?.stop(); cameraRef.current = null;
      handsRef.current?.close?.(); handsRef.current = null;
      smoothedRef.current = {};
      isProcessingRef.current = false;
      posCallbackRef.current?.({ detected: false, handIndex: 0 });
      posCallbackRef.current?.({ detected: false, handIndex: 1 });
      return;
    }

    let dead = false;
    const init = async () => {
      try {
        const hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
        const cfg = getHandTrackingRuntimeConfig(settingsRef.current);
        hands.setOptions({ ...cfg.options, maxNumHands: 2 });
        hands.onResults(onResults);
        if (dead) { hands.close?.(); return; }
        handsRef.current = hands;

        if (videoRef.current) {
          const cam = new Camera(videoRef.current, {
            onFrame: async () => {
              if (isProcessingRef.current) return;
              isProcessingRef.current = true;
              const src = preprocessVideoFrame(
                videoRef.current, settingsRef.current,
                procCanvasRef, procCtxRef,
                getHandTrackingRuntimeConfig(settingsRef.current).processing
              );
              try { await handsRef.current?.send({ image: src }); }
              finally { isProcessingRef.current = false; }
            },
            width: cfg.camera.width, height: cfg.camera.height,
          });
          if (dead) { cam.stop(); return; }
          await cam.start();
          if (dead) { cam.stop(); return; }
          cameraRef.current = cam;
        }
      } catch (e) { console.error('HandTracking init error:', e); }
    };

    init();
    return () => {
      dead = true;
      cameraRef.current?.stop(); cameraRef.current = null;
      handsRef.current?.close?.(); handsRef.current = null;
      isProcessingRef.current = false;
    };
  }, [isEnabled, settings.preprocessingQuality, onResults]);

  useEffect(() => {
    if (handsRef.current) {
      const cfg = getHandTrackingRuntimeConfig(settingsRef.current);
      handsRef.current.setOptions({ ...cfg.options, maxNumHands: 2 });
    }
  }, [settings.minDetectionConfidence, settings.minTrackingConfidence, settings.preprocessingQuality]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => setPreviewPos({
      x: Math.max(0, Math.min(e.clientX - dragOrigin.x, window.innerWidth - 272)),
      y: Math.max(0, Math.min(e.clientY - dragOrigin.y, window.innerHeight - 200)),
    });
    const up = () => setDragging(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [dragging, dragOrigin]);

  if (!isEnabled) return null;

  return (
    <div style={{ position: 'fixed', zIndex: 40, left: previewPos.x, top: previewPos.y, display: showPreview ? 'block' : 'none' }}>
      <div
        style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', borderRadius: 8, padding: 8, cursor: 'move', userSelect: 'none' }}
        onMouseDown={e => { setDragging(true); setDragOrigin({ x: e.clientX - previewPos.x, y: e.clientY - previewPos.y }); }}
      >
        <div style={{ color: '#fff', fontSize: 12, marginBottom: 4, textAlign: 'center' }}>Hand Tracking</div>
        <video ref={videoRef} style={{ display: 'none' }} playsInline autoPlay muted />
        <canvas
          ref={canvasRef}
          style={{
            width: 256, height: 192, objectFit: 'contain', background: '#000',
            borderRadius: 4, display: 'block',
            transform: `rotate(${-1 * (orientRot + camRot)}deg)`,
            transformOrigin: 'center',
          }}
        />
      </div>
    </div>
  );
};

export default HandTrackingService;