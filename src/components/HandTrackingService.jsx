import React, { useRef, useEffect, useState, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
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

const SLOT_STATE = { FREE: 0, TENTATIVE: 1, LOCKED: 2 };
const PRIMARY_SLOT = 0;
const LEFT_HAND_INDEX = 0;
const RIGHT_HAND_INDEX = 1;

const LOCK_FRAMES = 12;
const TENTATIVE_ABSENCE_FRAMES = 6;
const LOCKED_ABSENCE_FRAMES = 20;
const CONTINUITY_THRESHOLD = 0.18;
const PREDICT_THRESHOLD = 0.13;
const SHAPE_THRESHOLD = 0.40;
const SIZE_RATIO_MIN = 0.65;
const SIZE_RATIO_MAX = 1.45;
const VEL_SMOOTH = 0.80;
const FEAT_SMOOTH = 0.70;

const l2 = (a, b) => {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
};

const FEAT_INDICES = [4, 8, 12, 16, 20, 5, 9, 13, 17];
function computeFeatureVec(landmarks, handSize) {
  if (!landmarks || handSize <= 0) return null;
  const wrist = landmarks[0];
  return FEAT_INDICES.map(i => {
    const lm = landmarks[i];
    if (!lm) return 0;
    return Math.hypot(lm.x - wrist.x, lm.y - wrist.y) / handSize;
  });
}

function blendVec(prev, next, alpha) {
  if (!prev) return next;
  if (!next) return prev;
  return prev.map((v, i) => v * alpha + next[i] * (1 - alpha));
}

function computeHandSize(hand, cw, ch) {
  let total = 0, count = 0;
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!hand[a] || !hand[b]) continue;
    total += Math.hypot((hand[a].x - hand[b].x) * cw, (hand[a].y - hand[b].y) * ch);
    count++;
  }
  return count > 0 ? total / count : 0;
}

function isPalmFacingCamera(landmarks, handLabel) {
  const wrist = landmarks[0], indexMCP = landmarks[5], pinkyMCP = landmarks[17];
  const v1 = { x: indexMCP.x - wrist.x, y: indexMCP.y - wrist.y };
  const v2 = { x: pinkyMCP.x - wrist.x, y: pinkyMCP.y - wrist.y };
  const normalZ = v1.x * v2.y - v1.y * v2.x;
  return handLabel === 'Right' ? normalZ > 0 : normalZ < 0;
}

const makeEmptySlot = () => ({
  state: SLOT_STATE.FREE,
  wx: 0.5, wy: 0.5,
  absenceCount: 0, tentativeFrames: 0,
  velX: 0, velY: 0,
  handSize: 0, feat: null, handedness: null,
});
const makeEmptySlots = () => ({ [PRIMARY_SLOT]: makeEmptySlot() });

function drawHandConnectors(ctx, landmarks, connections, { color = '#00ff00', lineWidth = 2 } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (const [a, b] of connections) {
    if (!landmarks[a] || !landmarks[b]) continue;
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x, landmarks[a].y);
    ctx.lineTo(landmarks[b].x, landmarks[b].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHandLandmarks(ctx, landmarks, { color = '#ff0000', lineWidth = 1, radius = 3 } = {}) {
  ctx.save();
  ctx.fillStyle = color;
  for (const lm of landmarks) {
    if (!lm) continue;
    ctx.beginPath();
    ctx.arc(lm.x, lm.y, radius, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

const HandTrackingService = ({ onHandPosition, onGesture, onVideoReady, settings = {}, enabled, flipCamera = false }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const procCanvasRef = useRef(null);
  const procCtxRef = useRef(null);
  const settingsRef = useRef(settings);
  const posCallbackRef = useRef(onHandPosition);
  const gestureCallbackRef = useRef(onGesture);
  const videoReadyRef = useRef(onVideoReady);
  const showPreviewRef = useRef(settings.showPreview || false);
  const isProcessingRef = useRef(false);
  const smoothedRef = useRef({});
  const smoothingRef = useRef(0);
  const sensitivityRef = useRef(1);
  const cameraStreamRef = useRef(null);
  const animFrameRef = useRef(null);
  const handsRef = useRef(null);
  const flipCameraRef = useRef(flipCamera);
  const runtimeConfigRef = useRef(getHandTrackingRuntimeConfig(settings));
  const fpsRef = useRef({ value: 0, last: performance?.now?.() ?? Date.now() });
  const cameraFpsRef = useRef({ value: 0, lastNow: 0, lastFrames: null, callbackId: null, fallback: 0 });
  const frameLimiterRef = useRef({ lastSent: 0 });
  const slotsRef = useRef(makeEmptySlots());

  const [previewPos, setPreviewPos] = useState({ x: 16, y: 16 });
  const [dragging, setDragging] = useState(false);
  const [dragOrigin, setDragOrigin] = useState({ x: 0, y: 0 });

  const isEnabled = enabled ?? settings.enabled ?? false;
  const showPreview = settings.showPreview || false;
  const orientRot = CAMERA_ORIENTATION_ROTATIONS[settings.cameraOrientation || 'landscape'] ?? 0;
  const camRot = CAMERA_POSITION_ROTATIONS[settings.cameraPosition || 'top'] ?? 0;

  useEffect(() => {
    settingsRef.current = settings;
    runtimeConfigRef.current = getHandTrackingRuntimeConfig(settings);
    showPreviewRef.current = settings.showPreview || false;
    smoothingRef.current = clampVal(settings.smoothing, 0, 0.95, 0);
    sensitivityRef.current = clampVal(settings.sensitivity, 0.25, 3, 1);
  }, [settings]);

  useEffect(() => { flipCameraRef.current = flipCamera; }, [flipCamera]);
  useEffect(() => { posCallbackRef.current = onHandPosition; }, [onHandPosition]);
  useEffect(() => { gestureCallbackRef.current = onGesture; }, [onGesture]);
  useEffect(() => { videoReadyRef.current = onVideoReady; }, [onVideoReady]);
  useEffect(() => () => {
    posCallbackRef.current = null;
    gestureCallbackRef.current = null;
    videoReadyRef.current = null;
  }, []);

  const onResults = useCallback((results, w, h, ctx) => {
    const allHands = results.landmarks || [];
const allLabels = (results.handedness || []).map(h => {
  const raw = h[0]?.categoryName || 'Left';
  return { label: raw === 'Left' ? 'Right' : 'Left' };
});
    const s = settingsRef.current || {};

    const nowTs = performance?.now?.() ?? Date.now();
    const elapsed = nowTs - fpsRef.current.last;
    fpsRef.current.last = nowTs;
    fpsRef.current.value =
      FPS_SMOOTH * fpsRef.current.value +
      (1 - FPS_SMOOTH) * (elapsed > 0 ? 1000 / elapsed : 0);

    const measuredCameraFps = cameraFpsRef.current.value;
    const fallbackCameraFps = cameraFpsRef.current.fallback;
    const displayFps = measuredCameraFps > 0
      ? measuredCameraFps
      : (fallbackCameraFps > 0 ? fallbackCameraFps : fpsRef.current.value);

    const video = videoRef.current;

    if (showPreviewRef.current && ctx && video) {
      ctx.save();
      ctx.translate(w, 0); ctx.scale(-1, 1);
      if (flipCameraRef.current) {
        ctx.translate(0, h); ctx.scale(1, -1);
      }
      ctx.filter = getExposureFilterString(s);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(10, 10, 300, 48);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 54px "Segoe UI",Arial,sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`FPS: ${displayFps.toFixed(1)}`, 20, 34);
      ctx.restore();
    }

    const seenLabels = new Set();
    const candidates = [];
    allHands.forEach((hand, i) => {
      const label = allLabels[i]?.label || 'Left';
      if (!seenLabels.has(label)) {
        seenLabels.add(label);
        const al = computeHandSize(hand, w, h);
        candidates.push({ hand, label, wx: hand[0].x, wy: hand[0].y, al, feat: computeFeatureVec(hand, al) });
      }
    });

    const slots = slotsRef.current;
    const emitHidden = (handIndex) => posCallbackRef.current?.({ detected: false, handIndex });
    const emitOnlyActiveHand = (activeHandIndex) => {
      const inactive = activeHandIndex === LEFT_HAND_INDEX ? RIGHT_HAND_INDEX : LEFT_HAND_INDEX;
      smoothedRef.current[inactive] = null;
      emitHidden(inactive);
    };

    if (candidates.length === 0) {
      const sl = slots[PRIMARY_SLOT];
      if (sl.state !== SLOT_STATE.FREE) {
        sl.absenceCount++;
        const limit = sl.state === SLOT_STATE.LOCKED ? LOCKED_ABSENCE_FRAMES : TENTATIVE_ABSENCE_FRAMES;
        if (sl.absenceCount >= limit) {
          slots[PRIMARY_SLOT] = makeEmptySlot();
          smoothedRef.current[LEFT_HAND_INDEX] = null;
          smoothedRef.current[RIGHT_HAND_INDEX] = null;
        }
      }
      emitHidden(LEFT_HAND_INDEX);
      emitHidden(RIGHT_HAND_INDEX);
      return;
    }

    const sl = slots[PRIMARY_SLOT];
    let matchedCandidateIndex = -1;

    if (sl.state === SLOT_STATE.LOCKED) {
      const predX = sl.wx + sl.velX;
      const predY = sl.wy + sl.velY;
      let bestScore = Infinity;
      candidates.forEach(({ label, wx, wy, al, feat }, ci) => {
        const dPred = Math.hypot(wx - predX, wy - predY);
        if (dPred > PREDICT_THRESHOLD) return;
        if (sl.handSize > 0 && al > 0) {
          const ratio = al / sl.handSize;
          if (ratio < SIZE_RATIO_MIN || ratio > SIZE_RATIO_MAX) return;
        }
        const featDist = (sl.feat && feat) ? l2(sl.feat, feat) : 0;
        if (sl.feat && featDist > SHAPE_THRESHOLD) return;
        if (sl.handedness && label.toLowerCase() !== sl.handedness) return;
        const score = dPred * 1.0 + featDist * 0.6 + (sl.handSize > 0 ? Math.abs(1 - al / sl.handSize) * 0.4 : 0);
        if (score < bestScore) { bestScore = score; matchedCandidateIndex = ci; }
      });
    } else if (sl.state === SLOT_STATE.TENTATIVE) {
      let bestDist = CONTINUITY_THRESHOLD;
      candidates.forEach(({ wx, wy }, ci) => {
        const dist = Math.hypot(wx - sl.wx, wy - sl.wy);
        if (dist < bestDist) { bestDist = dist; matchedCandidateIndex = ci; }
      });
    } else {
      matchedCandidateIndex = 0;
    }

    if (matchedCandidateIndex !== -1) {
      const { hand, label, wx, wy, al } = candidates[matchedCandidateIndex];
      sl.velX = sl.velX * VEL_SMOOTH + (wx - sl.wx) * (1 - VEL_SMOOTH);
      sl.velY = sl.velY * VEL_SMOOTH + (wy - sl.wy) * (1 - VEL_SMOOTH);
      sl.wx = wx; sl.wy = wy; sl.absenceCount = 0;
      if (al > 0) {
        sl.handSize = sl.handSize > 0 ? sl.handSize * FEAT_SMOOTH + al * (1 - FEAT_SMOOTH) : al;
        sl.feat = blendVec(sl.feat, computeFeatureVec(hand, al), FEAT_SMOOTH);
        sl.handedness = label.toLowerCase();
      }
      if (sl.state === SLOT_STATE.FREE) {
        sl.state = SLOT_STATE.TENTATIVE; sl.tentativeFrames = 1;
      } else if (sl.state === SLOT_STATE.TENTATIVE) {
        sl.tentativeFrames++;
        if (sl.tentativeFrames >= LOCK_FRAMES) sl.state = SLOT_STATE.LOCKED;
      }
    } else {
      sl.absenceCount++;
      const resetSlot = () => {
        slots[PRIMARY_SLOT] = makeEmptySlot();
        smoothedRef.current[LEFT_HAND_INDEX] = null;
        smoothedRef.current[RIGHT_HAND_INDEX] = null;
        emitHidden(LEFT_HAND_INDEX);
        emitHidden(RIGHT_HAND_INDEX);
      };
      if (sl.state === SLOT_STATE.TENTATIVE && sl.absenceCount >= TENTATIVE_ABSENCE_FRAMES) resetSlot();
      else if (sl.state === SLOT_STATE.LOCKED && sl.absenceCount >= LOCKED_ABSENCE_FRAMES) resetSlot();
    }

    if (matchedCandidateIndex !== -1) {
      const { hand, label } = candidates[matchedCandidateIndex];
      const handIndex = label.toLowerCase() === 'right' ? RIGHT_HAND_INDEX : LEFT_HAND_INDEX;
      emitOnlyActiveHand(handIndex);

      const al = computeHandSize(hand, w, h);
      const palmVisible = isPalmFacingCamera(hand, label);

      if (showPreviewRef.current && ctx) {
        const mirrored = hand.map(lm => ({ ...lm, x: (1 - lm.x) * w, y: lm.y * h }));
        const stateTag = sl.state === SLOT_STATE.LOCKED ? '🔒'
          : sl.state === SLOT_STATE.TENTATIVE ? `⏳${sl.tentativeFrames}/${LOCK_FRAMES}` : '?';
        const lineColor = sl.state === SLOT_STATE.LOCKED
          ? (palmVisible ? '#00ff00' : '#888888') : '#ffaa00';
        drawHandConnectors(ctx, mirrored, HAND_CONNECTIONS, { color: lineColor, lineWidth: 2 });
        drawHandLandmarks(ctx, mirrored, { color: palmVisible ? '#ff0000' : '#555555', lineWidth: 1, radius: 3 });
        ctx.save();
        ctx.fillStyle = lineColor;
        ctx.font = 'bold 11px "Segoe UI",Arial,sans-serif';
        ctx.fillText(`s${PRIMARY_SLOT} ${stateTag} ${palmVisible ? 'Palm' : 'Back'}`, mirrored[0].x, mirrored[0].y - 10);
        ctx.restore();
      }

      if (!palmVisible) {
        posCallbackRef.current?.({
          detected: true, palmVisible: false, handIndex,
          x: smoothedRef.current[handIndex] ? smoothedRef.current[handIndex].x * window.innerWidth : window.innerWidth / 2,
          y: smoothedRef.current[handIndex] ? smoothedRef.current[handIndex].y * window.innerHeight : window.innerHeight / 2,
        });
      } else {
        if (!al || !isFinite(al) || al <= 0) return;

        const thumb = hand[4], index = hand[8];
        const middle = hand[12], pinky = hand[20];
        if (!thumb || !index || !middle || !pinky) return;

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

        const mcpIndex = hand[5], mcpMiddle = hand[9];
        const mcpRing = hand[13], mcpPinkyL = hand[17];
        if (!mcpIndex || !mcpMiddle || !mcpRing || !mcpPinkyL) return;

        const mcpX = (mcpIndex.x + mcpMiddle.x + mcpRing.x + mcpPinkyL.x) / 4;
        const mcpY = (mcpIndex.y + mcpMiddle.y + mcpRing.y + mcpPinkyL.y) / 4;
        const fmx = (thumb.x + index.x) / 2;
        const fmy = (thumb.y + index.y) / 2;

        const BLEND = 0.4;
        const mx = mcpX + (fmx - mcpX) * BLEND;
        const my = mcpY + (fmy - mcpY) * BLEND;

        const pinchMidX = fmx * window.innerWidth;
        const pinchMidY = fmy * window.innerHeight;

        const { x: nx, y: ny } = transformHandCoordinates(
          mx, my, s.cameraOrientation || 'landscape', s.cameraPosition || 'top',
        );

        const margin = clamp01(s.cameraMargin ?? 0.15);
        const remap = (v) => clamp01((v - margin) / (1 - 2 * margin));
        const ax = clamp01(((remap(nx) - 0.5) * sensitivityRef.current) + 0.5);
        const ay = clamp01(((remap(ny) - 0.5) * sensitivityRef.current) + 0.5);

        const sm = smoothingRef.current;
        const prev = smoothedRef.current[handIndex];
        let sx = ax, sy = ay;

        if (prev) {
          const moveDist = Math.hypot(ax - prev.x, ay - prev.y);
          const deadzone = 0.003 / Math.max(sensitivityRef.current, 0.25);
          if (moveDist < deadzone) {
            sx = prev.x; sy = prev.y;
          } else if (sm > 0) {
            const velX = prev.velX ?? 0;
            const velY = prev.velY ?? 0;
            const predX = prev.x + velX;
            const predY = prev.y + velY;
            const fastBlend = Math.min(moveDist / 0.06, 1.0);
            const targetX = ax * (1 - fastBlend * 0.4) + predX * (fastBlend * 0.4);
            const targetY = ay * (1 - fastBlend * 0.4) + predY * (fastBlend * 0.4);
            const baseSm = isPinching ? Math.min(sm + 0.06, 0.88) : sm;
            const speedFactor = Math.min(moveDist / 0.05, 1.0);
            const finalSm = baseSm * (1 - speedFactor * 0.55);
            sx = prev.x + (targetX - prev.x) * (1 - finalSm);
            sy = prev.y + (targetY - prev.y) * (1 - finalSm);
          }
        }
        const velX = sx - (prev?.x ?? sx);
        const velY = sy - (prev?.y ?? sy);
        smoothedRef.current[handIndex] = {
          x: sx, y: sy,
          velX: ((prev?.velX ?? 0) * 0.6 + velX * 0.4),
          velY: ((prev?.velY ?? 0) * 0.6 + velY * 0.4),
        };

        const finalX = flipCameraRef.current ? (1 - sx) * window.innerWidth : sx * window.innerWidth;
        const finalY = flipCameraRef.current ? (1 - sy) * window.innerHeight : sy * window.innerHeight;
        const finalPinchMidX = flipCameraRef.current ? window.innerWidth - pinchMidX : pinchMidX;
        const finalPinchMidY = flipCameraRef.current ? window.innerHeight - pinchMidY : pinchMidY;

        posCallbackRef.current?.({
          x: finalX,
          y: finalY,
          detected: true, palmVisible: true,
          isPinching, pinchStrength: Math.min(pinchStr, 1), pinchDistance: normPinch,
          isClicking, clickStrength: Math.min(clickStr, 1),
          isFist, fistStrength: clamp01(1 - normPinky / fistThr),
          isHandOpen, pinkyThumbDistanceRatio: normPinky,
          handedness: label.toLowerCase(), handIndex, handSize: al,
          pinchMidX: finalPinchMidX, pinchMidY: finalPinchMidY,
        });

        if (showPreviewRef.current && ctx) {
          const mTX = (1 - thumb.x) * w, mTY = thumb.y * h;
          const mIX = (1 - index.x) * w, mIY = index.y * h;
          const mMDX = (1 - middle.x) * w, mMDY = middle.y * h;
          const midX = (mTX + mIX) / 2, midY = (mTY + mIY) / 2;
          const ratio = al / w;
          const dotR = Math.max(0.8, w * ratio * 0.07);
          const midR = Math.max(1, w * ratio * (isPinching ? 0.11 : 0.08));
          ctx.beginPath(); ctx.arc(mTX, mTY, dotR, 0, 2 * Math.PI); ctx.fillStyle = '#FF00FF'; ctx.fill();
          ctx.beginPath(); ctx.arc(mIX, mIY, dotR, 0, 2 * Math.PI); ctx.fillStyle = '#00FF88'; ctx.fill();
          ctx.beginPath(); ctx.arc(mMDX, mMDY, dotR, 0, 2 * Math.PI); ctx.fillStyle = '#FFD700'; ctx.fill();
          ctx.beginPath(); ctx.arc(midX, midY, midR, 0, 2 * Math.PI);
          ctx.globalAlpha = isPinching ? 0.9 : 0.6;
          ctx.fillStyle = isPinching ? '#ffffff' : '#00FFFF';
          ctx.fill(); ctx.globalAlpha = 1;
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      handsRef.current?.close?.();
      handsRef.current = null;
      smoothedRef.current = {};
      slotsRef.current = makeEmptySlots();
      isProcessingRef.current = false;
      frameLimiterRef.current.lastSent = 0;
      cameraFpsRef.current.value = 0;
      cameraFpsRef.current.lastNow = 0;
      cameraFpsRef.current.lastFrames = null;
      cameraFpsRef.current.fallback = 0;
      if (videoRef.current?.cancelVideoFrameCallback && cameraFpsRef.current.callbackId !== null)
        videoRef.current.cancelVideoFrameCallback(cameraFpsRef.current.callbackId);
      cameraFpsRef.current.callbackId = null;
      posCallbackRef.current?.({ detected: false, handIndex: 0 });
      posCallbackRef.current?.({ detected: false, handIndex: 1 });
      return;
    }

    let dead = false;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const cfg = runtimeConfigRef.current;

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'CPU', // No WebGL — runs on Pi 4/5
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: cfg.options.minDetectionConfidence,
          minHandPresenceConfidence: cfg.options.minTrackingConfidence,
          minTrackingConfidence: cfg.options.minTrackingConfidence,
        });

        if (dead) { handLandmarker.close?.(); return; }
        handsRef.current = handLandmarker;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: cfg.camera.width },
            height: { ideal: cfg.camera.height },
          },
          audio: false,
        });

        if (dead) { stream.getTracks().forEach(t => t.stop()); return; }
        cameraStreamRef.current = stream;

        const videoEl = videoRef.current;
        if (!videoEl) return;

        videoEl.srcObject = stream;
        await new Promise((resolve) => {
          if (videoEl.readyState >= 2) { resolve(); return; }
          videoEl.addEventListener('loadeddata', resolve, { once: true });
        });
        await videoEl.play();

        if (dead) return;

        const track = stream.getVideoTracks?.()?.[0];
        const trackFps = Number(track?.getSettings?.()?.frameRate);
        if (Number.isFinite(trackFps) && trackFps > 0)
          cameraFpsRef.current.fallback = trackFps;

        if (typeof videoEl.requestVideoFrameCallback === 'function') {
          const onVideoFrame = (_now, metadata) => {
            if (dead) return;
            const now = performance?.now?.() ?? Date.now();
            const frames = Number(metadata?.presentedFrames);
            if (
              Number.isFinite(frames) &&
              cameraFpsRef.current.lastFrames !== null &&
              cameraFpsRef.current.lastNow > 0
            ) {
              const dFrames = frames - cameraFpsRef.current.lastFrames;
              const dTimeMs = now - cameraFpsRef.current.lastNow;
              if (dFrames > 0 && dTimeMs > 0) {
                const instFps = (dFrames * 1000) / dTimeMs;
                cameraFpsRef.current.value =
                  FPS_SMOOTH * cameraFpsRef.current.value +
                  (1 - FPS_SMOOTH) * instFps;
              }
            }
            if (Number.isFinite(frames)) cameraFpsRef.current.lastFrames = frames;
            cameraFpsRef.current.lastNow = now;
            cameraFpsRef.current.callbackId = videoEl.requestVideoFrameCallback(onVideoFrame);
          };
          cameraFpsRef.current.callbackId = videoEl.requestVideoFrameCallback(onVideoFrame);
        }

        videoReadyRef.current?.(videoEl);

        const processFrame = () => {
          if (dead) return;
          animFrameRef.current = requestAnimationFrame(processFrame);

          if (isProcessingRef.current) return;
          if (!handsRef.current || !videoEl || videoEl.readyState < 2) return;

          const currentCfg = runtimeConfigRef.current;
          const maxFps = currentCfg?.maxFrameRate;
          if (Number.isFinite(maxFps) && maxFps > 0) {
            const now = performance?.now?.() ?? Date.now();
            const minDelta = 1000 / maxFps;
            if (now - frameLimiterRef.current.lastSent < minDelta) return;
            frameLimiterRef.current.lastSent = now;
          }

          isProcessingRef.current = true;

          const canvas = canvasRef.current;
          const w = videoEl.videoWidth;
          const h = videoEl.videoHeight;

          let ctx = null;
          if (canvas) {
            canvas.width = w;
            canvas.height = h;
            ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, w, h);
          }

          const src = preprocessVideoFrame(
            videoEl, settingsRef.current,
            procCanvasRef, procCtxRef, currentCfg.processing,
          );

          try {
            const nowMs = performance?.now?.() ?? Date.now();
            const result = handsRef.current.detectForVideo(src, nowMs);
            onResults(result, w, h, ctx);
          } catch (e) {
            console.warn('HandLandmarker detectForVideo error:', e);
          } finally {
            isProcessingRef.current = false;
          }
        };

        animFrameRef.current = requestAnimationFrame(processFrame);

      } catch (e) {
        console.error('HandTracking init error:', e);
      }
    };

    init();

    return () => {
      dead = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
      handsRef.current?.close?.();
      handsRef.current = null;
      isProcessingRef.current = false;
      frameLimiterRef.current.lastSent = 0;
      cameraFpsRef.current.value = 0;
      cameraFpsRef.current.lastNow = 0;
      cameraFpsRef.current.lastFrames = null;
      cameraFpsRef.current.fallback = 0;
      if (videoRef.current?.cancelVideoFrameCallback && cameraFpsRef.current.callbackId !== null)
        videoRef.current.cancelVideoFrameCallback(cameraFpsRef.current.callbackId);
      cameraFpsRef.current.callbackId = null;
    };
  }, [isEnabled, settings.preprocessingQuality, onResults]);

  useEffect(() => {
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
        <video ref={videoRef} style={{ display: 'none', transform: flipCamera ? 'scaleY(-1)' : 'none' }} playsInline autoPlay muted />
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