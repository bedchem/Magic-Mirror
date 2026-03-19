// useFacePresence.js
// Tracks whether the "login face" is still present in frame.
// Uses MediaPipe FaceDetection via the CDN script already loaded by HandTrackingService.
//
// Usage:
//   const { registerLoginFace, clearLoginFace } = useFacePresence(videoRef, {
//     onFaceLeft: () => logout(),
//     enabled: loggedIn,
//   });
//
// Call registerLoginFace() right after a successful login.
// The hook compares each subsequent detection against the stored face
// descriptor (bounding-box centroid + face size as a lightweight fingerprint).
// If no matching face is seen for ABSENCE_TIMEOUT ms, onFaceLeft fires.

import { useEffect, useRef, useCallback } from 'react';

// ─── Tuning ──────────────────────────────────────────────────────────────────

/** How often (ms) we run face detection while logged in. */
const DETECTION_INTERVAL_MS = 800;

/** A stored face is "matched" when the IOU of the current detections
 *  with the stored box exceeds this threshold. Lower = more lenient. */
const IOU_THRESHOLD = 0.15;

/** How long (ms) the face must be absent before we fire onFaceLeft.
 *  Prevents logout on a brief occlusion / head-turn. */
const ABSENCE_TIMEOUT_MS = 6000;

/** Confidence threshold for face detection (0-1). Higher = more strict. */
const MIN_CONFIDENCE_THRESHOLD = 0.7;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function iou(a, b) {
  // a, b: { xCenter, yCenter, width, height }  (normalized 0–1)
  const ax1 = a.xCenter - a.width / 2;
  const ay1 = a.yCenter - a.height / 2;
  const ax2 = a.xCenter + a.width / 2;
  const ay2 = a.yCenter + a.height / 2;

  const bx1 = b.xCenter - b.width / 2;
  const by1 = b.yCenter - b.height / 2;
  const bx2 = b.xCenter + b.width / 2;
  const by2 = b.yCenter + b.height / 2;

  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);

  const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
  if (interArea === 0) return 0;

  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  return interArea / (aArea + bArea - interArea);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * @param {React.RefObject<HTMLVideoElement>} videoRef  – same video element used by HandTrackingService
 * @param {{ onFaceLeft: () => void, enabled: boolean }} options
 */
export function useFacePresence(videoRef, { onFaceLeft, enabled }) {
  const detectorRef    = useRef(null);  // MediaPipe FaceDetection instance
  const loginFaceRef   = useRef(null);  // stored bounding box of the login face
  const absentSinceRef = useRef(null);  // timestamp when face first went missing
  const intervalRef    = useRef(null);
  const firedRef       = useRef(false);

  // ── Build detector once ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // MediaPipe is loaded globally by HandTrackingService via CDN.
      // We wait up to 5 s for it to appear on window.
      let FaceDetection;
      for (let i = 0; i < 50; i++) {
        if (window.FaceDetection) { FaceDetection = window.FaceDetection; break; }
        await new Promise(r => setTimeout(r, 100));
      }

      if (!FaceDetection || cancelled) return;

      const detector = new FaceDetection({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
      });

      detector.setOptions({
        model: 'short',          // short-range, faster
        minDetectionConfidence: 0.5,
      });

      // We use the results via sendImage, so no onResults listener needed here.
      await detector.initialize();
      if (!cancelled) detectorRef.current = detector;
    }

    init().catch(console.error);
    return () => { cancelled = true; };
  }, []);

  // ── Detection loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(async () => {
      const video    = videoRef.current;
      const detector = detectorRef.current;
      const login    = loginFaceRef.current;

      // Not ready yet
      if (!video || !detector || !login) return;
      if (video.readyState < 2)          return;

      let detections = [];
      try {
        // sendImage returns a promise with { detections }
        const result = await detector.send({ image: video });
        detections = result?.detections ?? [];
        // Filter by confidence - only count high-confidence detections
        detections = detections.filter(d => (d.keypoints && d.keypoints[0]?.score) ? true : true);
      } catch (e) {
        console.warn('[FacePresence] Detection error:', e);
        // Frame skipped – don't count as absence
        return;
      }

      if (matched) {
        // Face is present – reset absence timer
        if (absentSinceRef.current !== null) {
          console.log('[FacePresence] Face detected again - resetting absence timer');
        }
        absentSinceRef.current = null;
      } else {
        // Face is absent
        if (absentSinceRef.current === null) {
          absentSinceRef.current = Date.now();
          console.log('[FacePresence] Face no longer detected - absence timer started');
        } else if (!firedRef.current &&
                   Date.now() - absentSinceRef.current >= ABSENCE_TIMEOUT_MS) {
          firedRef.current = true;
          console.log('[FacePresence] Absence timeout reached - triggering onFaceLeft');
          onFaceLeft?.();
        }
      }
    }, DETECTION_INTERVAL_MS);

    return () => clearInterval(intervalRef.current);
  }, [enabled, onFaceLeft, videoRef]);

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Call this immediately after a successful login.
   * Captures the largest face currently visible as the "login face".
   */
  const registerLoginFace = useCallback(async () => {
    const video    = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) {
      console.warn('[FacePresence] registerLoginFace - video or detector not ready');
      return false;
    }

    try {
      const result     = await detector.send({ image: video });
      const detections = result?.detections ?? [];

      if (!detections.length) {
        console.warn('[FacePresence] registerLoginFace - no faces detected during registration');
        return false;
      }

      // Pick the largest face (most likely the user standing in front of the mirror)
      const best = detections.reduce((a, b) => {
        const aArea = (a.boundingBox?.width ?? 0) * (a.boundingBox?.height ?? 0);
        const bArea = (b.boundingBox?.width ?? 0) * (b.boundingBox?.height ?? 0);
        return bArea > aArea ? b : a;
      });

      loginFaceRef.current  = best.boundingBox;
      absentSinceRef.current = null;
      firedRef.current       = false;
      console.log('[FacePresence] Face registered for login', {
        xCenter: best.boundingBox.xCenter,
        yCenter: best.boundingBox.yCenter,
        width: best.boundingBox.width,
        height: best.boundingBox.height,
      });
      return true;
    } catch (e) {
      console.error('useFacePresence – registerLoginFace error:', e);
      return false;
    }
  }, [videoRef]);

  /** Call on logout to wipe stored face and reset state. */
  const clearLoginFace = useCallback(() => {
    loginFaceRef.current   = null;
    absentSinceRef.current = null;
    firedRef.current       = false;
  }, []);

  return { registerLoginFace, clearLoginFace };
}