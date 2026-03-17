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
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
];

const SLOT_STATE = { FREE: 0, TENTATIVE: 1, LOCKED: 2 };
const PRIMARY_SLOT = 0;
const LEFT_HAND_INDEX = 0;
const RIGHT_HAND_INDEX = 1;

const LOCK_FRAMES = 45;

const TENTATIVE_ABSENCE_FRAMES = 6;

const LOCKED_ABSENCE_FRAMES = 90;

const CONTINUITY_THRESHOLD = 0.18;

const PREDICT_THRESHOLD = 0.13;

const SHAPE_THRESHOLD = 0.40;

const SIZE_RATIO_MIN = 0.65;
const SIZE_RATIO_MAX = 1.45;

const VEL_SMOOTH  = 0.80;
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
  state:           SLOT_STATE.FREE,
  wx:              0.5,
  wy:              0.5,
  absenceCount:    0,
  tentativeFrames: 0,
  velX:            0,
  velY:            0,
  handSize:        0,
  feat:            null,
  handedness:      null,
});
const makeEmptySlots = () => ({ [PRIMARY_SLOT]: makeEmptySlot() });

const HandTrackingService = ({ onHandPosition, onGesture, onVideoReady, settings = {}, enabled }) => {
  const videoRef           = useRef(null);
  const canvasRef          = useRef(null);
  const procCanvasRef      = useRef(null);
  const procCtxRef         = useRef(null);
  const settingsRef        = useRef(settings);
  const posCallbackRef     = useRef(onHandPosition);
  const gestureCallbackRef = useRef(onGesture);
  const videoReadyRef      = useRef(onVideoReady);
  const showPreviewRef     = useRef(settings.showPreview || false);
  const isProcessingRef    = useRef(false);
  const smoothedRef        = useRef({});
  const smoothingRef       = useRef(0);
  const sensitivityRef     = useRef(1);
  const cameraRef          = useRef(null);
  const handsRef           = useRef(null);
  const fpsRef             = useRef({ value: 0, last: performance?.now?.() ?? Date.now() });
  const slotsRef           = useRef(makeEmptySlots());

  const [previewPos, setPreviewPos] = useState({ x: 16, y: 16 });
  const [dragging, setDragging]     = useState(false);
  const [dragOrigin, setDragOrigin] = useState({ x: 0, y: 0 });

  const isEnabled   = enabled ?? settings.enabled ?? false;
  const showPreview = settings.showPreview || false;
  const orientRot   = CAMERA_ORIENTATION_ROTATIONS[settings.cameraOrientation || 'landscape'] ?? 0;
  const camRot      = CAMERA_POSITION_ROTATIONS[settings.cameraPosition    || 'top']         ?? 0;

  useEffect(() => {
    settingsRef.current    = settings;
    showPreviewRef.current = settings.showPreview || false;
    smoothingRef.current   = clampVal(settings.smoothing,   0,    0.95, 0);
    sensitivityRef.current = clampVal(settings.sensitivity, 0.25, 3,    1);
  }, [settings]);

  useEffect(() => { posCallbackRef.current     = onHandPosition; }, [onHandPosition]);
  useEffect(() => { gestureCallbackRef.current = onGesture;      }, [onGesture]);
  useEffect(() => { videoReadyRef.current      = onVideoReady;   }, [onVideoReady]);
  useEffect(() => () => {
    posCallbackRef.current     = null;
    gestureCallbackRef.current = null;
    videoReadyRef.current      = null;
  }, []);

  const onResults = useCallback((results) => {
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    const w   = canvas.width  = video.videoWidth;
    const h   = canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, w, h);
    const s = settingsRef.current || {};

    const nowTs   = performance?.now?.() ?? Date.now();
    const elapsed = nowTs - fpsRef.current.last;
    fpsRef.current.last  = nowTs;
    fpsRef.current.value =
      FPS_SMOOTH * fpsRef.current.value +
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

    const allHands  = results.multiHandLandmarks || [];
    const allLabels = results.multiHandedness    || [];

    const seenLabels = new Set();
    const candidates = [];
    allHands.forEach((hand, i) => {
      const label = allLabels[i]?.label || 'Left';
      if (!seenLabels.has(label)) {
        seenLabels.add(label);
        const al = computeHandSize(hand, w, h);
        candidates.push({
          hand,
          label,
          wx:   hand[0].x,
          wy:   hand[0].y,
          al,
          feat: computeFeatureVec(hand, al),
        });
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
        const limit = sl.state === SLOT_STATE.LOCKED
          ? LOCKED_ABSENCE_FRAMES
          : TENTATIVE_ABSENCE_FRAMES;
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

        const score = dPred * 1.0
                    + featDist * 0.6
                    + (sl.handSize > 0 ? Math.abs(1 - al / sl.handSize) * 0.4 : 0);

        if (score < bestScore) {
          bestScore = score;
          matchedCandidateIndex = ci;
        }
      });
    } else if (sl.state === SLOT_STATE.TENTATIVE) {
      let bestDist = CONTINUITY_THRESHOLD;
      candidates.forEach(({ wx, wy }, ci) => {
        const dist = Math.hypot(wx - sl.wx, wy - sl.wy);
        if (dist < bestDist) {
          bestDist = dist;
          matchedCandidateIndex = ci;
        }
      });
    } else {
      matchedCandidateIndex = 0;
    }

    if (matchedCandidateIndex !== -1) {
      const { hand, label, wx, wy, al } = candidates[matchedCandidateIndex];

      const rawVelX = wx - sl.wx;
      const rawVelY = wy - sl.wy;
      sl.velX = sl.velX * VEL_SMOOTH + rawVelX * (1 - VEL_SMOOTH);
      sl.velY = sl.velY * VEL_SMOOTH + rawVelY * (1 - VEL_SMOOTH);

      sl.wx = wx;
      sl.wy = wy;
      sl.absenceCount = 0;

      if (al > 0) {
        sl.handSize  = sl.handSize > 0
          ? sl.handSize * FEAT_SMOOTH + al * (1 - FEAT_SMOOTH)
          : al;
        sl.feat      = blendVec(sl.feat, computeFeatureVec(hand, al), FEAT_SMOOTH);
        sl.handedness = label.toLowerCase();
      }

      if (sl.state === SLOT_STATE.FREE) {
        sl.state           = SLOT_STATE.TENTATIVE;
        sl.tentativeFrames = 1;
      } else if (sl.state === SLOT_STATE.TENTATIVE) {
        sl.tentativeFrames++;
        if (sl.tentativeFrames >= LOCK_FRAMES) {
          sl.state = SLOT_STATE.LOCKED;
        }
      }
    } else {
      sl.absenceCount++;

      if (sl.state === SLOT_STATE.TENTATIVE) {
        if (sl.absenceCount >= TENTATIVE_ABSENCE_FRAMES) {
          slots[PRIMARY_SLOT] = makeEmptySlot();
          smoothedRef.current[LEFT_HAND_INDEX] = null;
          smoothedRef.current[RIGHT_HAND_INDEX] = null;
          emitHidden(LEFT_HAND_INDEX);
          emitHidden(RIGHT_HAND_INDEX);
        }
      } else if (sl.state === SLOT_STATE.LOCKED) {
        if (sl.absenceCount >= LOCKED_ABSENCE_FRAMES) {
          slots[PRIMARY_SLOT] = makeEmptySlot();
          smoothedRef.current[LEFT_HAND_INDEX] = null;
          smoothedRef.current[RIGHT_HAND_INDEX] = null;
          emitHidden(LEFT_HAND_INDEX);
          emitHidden(RIGHT_HAND_INDEX);
        }
      }
    }

    if (matchedCandidateIndex !== -1) {
      const { hand, label } = candidates[matchedCandidateIndex];
      const handIndex = label.toLowerCase() === 'right' ? RIGHT_HAND_INDEX : LEFT_HAND_INDEX;
      emitOnlyActiveHand(handIndex);

      const al          = computeHandSize(hand, w, h);
      const palmVisible = isPalmFacingCamera(hand, label);

      if (showPreviewRef.current) {
        const mirrored = hand.map(lm => ({ ...lm, x: 1 - lm.x }));
        const stateTag = sl.state === SLOT_STATE.LOCKED     ? '🔒' :
                         sl.state === SLOT_STATE.TENTATIVE  ? `⏳${sl.tentativeFrames}/${LOCK_FRAMES}` : '?';
        const lineColor = sl.state === SLOT_STATE.LOCKED
          ? (palmVisible ? '#00ff00' : '#888888')
          : '#ffaa00';
        drawConnectors(ctx, mirrored, HAND_CONNECTIONS, { color: lineColor, lineWidth: 2 });
        drawLandmarks(ctx, mirrored, { color: palmVisible ? '#ff0000' : '#555555', lineWidth: 1 });
        const mWrist = mirrored[0];
        ctx.save();
        ctx.fillStyle = lineColor;
        ctx.font = 'bold 11px "Segoe UI",Arial,sans-serif';
        ctx.fillText(`s${PRIMARY_SLOT} ${stateTag} ${palmVisible ? 'Palm' : 'Back'}`, mWrist.x * w, mWrist.y * h - 10);
        ctx.restore();
      }

      if (!palmVisible) {
        posCallbackRef.current?.({
          detected: true,
          palmVisible: false,
          handIndex,
          x: smoothedRef.current[handIndex]
            ? smoothedRef.current[handIndex].x * window.innerWidth
            : window.innerWidth  / 2,
          y: smoothedRef.current[handIndex]
            ? smoothedRef.current[handIndex].y * window.innerHeight
            : window.innerHeight / 2,
        });
      } else {
        if (!al || !isFinite(al) || al <= 0) return;

        const thumb  = hand[4], index  = hand[8];
        const middle = hand[12], pinky = hand[20];
        if (!thumb || !index || !middle || !pinky) return;

        const tx  = thumb.x  * w, ty  = thumb.y  * h;
        const ix  = index.x  * w, iy  = index.y  * h;
        const mdx = middle.x * w, mdy = middle.y * h;
        const pkx = pinky.x  * w, pky = pinky.y  * h;

        const pinchDist = Math.hypot(tx - ix,  ty - iy);
        const clickDist = Math.hypot(tx - mdx, ty - mdy);
        const pinkyDist = Math.hypot(tx - pkx, ty - pky);

        const pinchThr  = s.pinchSensitivity || 0.2;
        const normPinch = clamp01(pinchDist / (al * 4.5));
        const scaledThr = al * 4.5 * pinchThr;
        const pinchStr  = scaledThr > 0 ? Math.max(0, 1 - pinchDist / scaledThr) : 0;
        const isPinching  = pinchDist < scaledThr;
        const clickStr    = scaledThr > 0 ? Math.max(0, 1 - clickDist / scaledThr) : 0;
        const isClicking  = clickDist < scaledThr;

        const fistThr    = s.fistThreshold  || 0.35;
        const openThr    = Math.max(s.openThreshold || 0.65, fistThr + 0.1);
        const normPinky  = al ? pinkyDist / al : 0;
        const isFist     = normPinky <= fistThr;
        const isHandOpen = normPinky >= openThr;

        const mcpIndex  = hand[5],  mcpMiddle = hand[9];
        const mcpRing   = hand[13], mcpPinkyL = hand[17];
        if (!mcpIndex || !mcpMiddle || !mcpRing || !mcpPinkyL) return;

        const mcpX = (mcpIndex.x + mcpMiddle.x + mcpRing.x + mcpPinkyL.x) / 4;
        const mcpY = (mcpIndex.y + mcpMiddle.y + mcpRing.y + mcpPinkyL.y) / 4;
        const fmx  = (thumb.x + index.x) / 2;
        const fmy  = (thumb.y + index.y) / 2;

        const BLEND = 0.4;
        const mx = mcpX + (fmx - mcpX) * BLEND;
        const my = mcpY + (fmy - mcpY) * BLEND;

        const pinchMidX = fmx * window.innerWidth;
        const pinchMidY = fmy * window.innerHeight;

        const { x: nx, y: ny } = transformHandCoordinates(
          mx, my, s.cameraOrientation || 'landscape', s.cameraPosition || 'top',
        );

        const margin = clamp01(s.cameraMargin ?? 0.15);
        const remap  = (v) => clamp01((v - margin) / (1 - 2 * margin));
        const ax = clamp01(((remap(nx) - 0.5) * sensitivityRef.current) + 0.5);
        const ay = clamp01(((remap(ny) - 0.5) * sensitivityRef.current) + 0.5);

        const sm   = smoothingRef.current;
        const prev = smoothedRef.current[handIndex];
        let sx = ax, sy = ay;

        if (prev) {
          const moveDist = Math.hypot(ax - prev.x, ay - prev.y);
          const deadzone = 0.008 / Math.max(sensitivityRef.current, 0.25);
          if (moveDist < deadzone) {
            sx = prev.x; sy = prev.y;
          } else if (sm > 0) {
            const effectiveSm = isPinching ? Math.min(sm + 0.12, 0.92) : sm;
            const adaptiveSm  = moveDist > 0.06 ? Math.max(effectiveSm - 0.15, 0) : effectiveSm;
            sx = prev.x + (ax - prev.x) * (1 - adaptiveSm);
            sy = prev.y + (ay - prev.y) * (1 - adaptiveSm);
          }
        }
        smoothedRef.current[handIndex] = { x: sx, y: sy };

        posCallbackRef.current?.({
          x: sx * window.innerWidth,
          y: sy * window.innerHeight,
          detected: true,
          palmVisible: true,
          isPinching,
          pinchStrength:           Math.min(pinchStr, 1),
          pinchDistance:           normPinch,
          isClicking,
          clickStrength:           Math.min(clickStr, 1),
          isFist,
          fistStrength:            clamp01(1 - normPinky / fistThr),
          isHandOpen,
          pinkyThumbDistanceRatio: normPinky,
          handedness:              label.toLowerCase(),
          handIndex,
          handSize:                al,
          pinchMidX,
          pinchMidY,
        });

        if (showPreviewRef.current) {
          const mirrored = hand.map(lm => ({ ...lm, x: 1 - lm.x }));
          const mTX  = mirrored[4].x  * w, mTY  = mirrored[4].y  * h;
          const mIX  = mirrored[8].x  * w, mIY  = mirrored[8].y  * h;
          const mMDX = mirrored[12].x * w, mMDY = mirrored[12].y * h;
          const midX = (mTX + mIX) / 2,   midY = (mTY + mIY) / 2;
          const ratio = al / w;
          const dotR  = Math.max(0.8, w * ratio * 0.07);
          const midR  = Math.max(1,   w * ratio * (isPinching ? 0.11 : 0.08));
          ctx.beginPath(); ctx.arc(mTX,  mTY,  dotR, 0, 2 * Math.PI);
          ctx.fillStyle = '#FF00FF'; ctx.fill();
          ctx.beginPath(); ctx.arc(mIX,  mIY,  dotR, 0, 2 * Math.PI);
          ctx.fillStyle = '#00FF88'; ctx.fill();
          ctx.beginPath(); ctx.arc(mMDX, mMDY, dotR, 0, 2 * Math.PI);
          ctx.fillStyle = '#FFD700'; ctx.fill();
          ctx.beginPath(); ctx.arc(midX, midY, midR, 0, 2 * Math.PI);
          ctx.globalAlpha = isPinching ? 0.9 : 0.6;
          ctx.fillStyle   = isPinching ? '#ffffff' : '#00FFFF';
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      cameraRef.current?.stop(); cameraRef.current = null;
      handsRef.current?.close?.(); handsRef.current = null;
      smoothedRef.current = {};
      slotsRef.current    = makeEmptySlots();
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
        hands.setOptions({ ...cfg.options, maxNumHands: 1 });
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
                getHandTrackingRuntimeConfig(settingsRef.current).processing,
              );
              try   { await handsRef.current?.send({ image: src }); }
              finally { isProcessingRef.current = false; }
            },
            width: cfg.camera.width, height: cfg.camera.height,
          });
          if (dead) { cam.stop(); return; }
          await cam.start();
          if (dead) { cam.stop(); return; }
          cameraRef.current = cam;

          const videoEl = videoRef.current;
          if (videoEl) {
            if (videoEl.readyState >= 2) {
              videoReadyRef.current?.(videoEl);
            } else {
              const handleLoadedData = () => {
                videoReadyRef.current?.(videoEl);
              };
              videoEl.addEventListener('loadeddata', handleLoadedData, { once: true });
            }
          }
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
      handsRef.current.setOptions({ ...cfg.options, maxNumHands: 1 });
    }
  }, [settings.minDetectionConfidence, settings.minTrackingConfidence, settings.preprocessingQuality]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => setPreviewPos({
      x: Math.max(0, Math.min(e.clientX - dragOrigin.x, window.innerWidth  - 272)),
      y: Math.max(0, Math.min(e.clientY - dragOrigin.y, window.innerHeight - 200)),
    });
    const up = () => setDragging(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup',   up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup',   up);
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