// useFacePresence.js
// Tracks whether the "login face" is still present in frame.
// Reuses the FaceDetection instance shared by HandTrackingService via
// window.__sharedFaceDetector to avoid MediaPipe WASM deadlocks that occur
// when two solutions initialize in parallel.
//
// Usage:
//   const { registerLoginFace, clearLoginFace } = useFacePresence(videoRef, {
//     onFaceLeft: () => logout(),
//     enabled: loggedIn,
//   });
//
// Call registerLoginFace() right after a successful login.
// If no matching face is seen for ABSENCE_TIMEOUT_MS, onFaceLeft fires.

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

/** How often (ms) registerLoginFace retries while detector isn't ready yet. */
const REGISTER_RETRY_INTERVAL_MS = 200;

/** Total time (ms) registerLoginFace will wait for the detector before giving up. */
const REGISTER_RETRY_TIMEOUT_MS = 12000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function iou(a, b) {
  // a, b: { xCenter, yCenter, width, height }  (normalized 0–1)
  const ax1 = a.xCenter - a.width / 2,  ay1 = a.yCenter - a.height / 2;
  const ax2 = a.xCenter + a.width / 2,  ay2 = a.yCenter + a.height / 2;
  const bx1 = b.xCenter - b.width / 2,  by1 = b.yCenter - b.height / 2;
  const bx2 = b.xCenter + b.width / 2,  by2 = b.yCenter + b.height / 2;

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = ix * iy;
  if (!inter) return 0;
  return inter / (a.width * a.height + b.width * b.height - inter);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * @param {React.RefObject<HTMLVideoElement>} videoRef  – same video element used by HandTrackingService
 * @param {{ onFaceLeft: () => void, enabled: boolean }} options
 */
export function useFacePresence(videoRef, { onFaceLeft, enabled }) {
  const detectorRef    = useRef(null);  // MediaPipe FaceDetection instance (shared)
  const loginFaceRef   = useRef(null);  // stored bounding box of the login face
  const absentSinceRef = useRef(null);  // timestamp when face first went missing
  const intervalRef    = useRef(null);
  const firedRef       = useRef(false);

  // ── Wait for HandTrackingService to expose the shared detector ───────────
  // HandTrackingService initializes FaceDetection sequentially after Hands
  // and stores the result at window.__sharedFaceDetector. We simply poll for
  // it — no separate initialize() call needed or safe here.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      for (let i = 0; i < 120; i++) {
        if (cancelled) return;
        if (window.__sharedFaceDetector) {
          detectorRef.current = window.__sharedFaceDetector;
          console.log('[FacePresence] Shared FaceDetector acquired ✓');
          return;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      console.warn('[FacePresence] window.__sharedFaceDetector never appeared — face presence disabled');
    }

    init();
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

      // Not ready yet — skip frame silently
      if (!video || !detector || !login) return;
      if (video.readyState < 2) return;

      let detections = [];
      try {
        const result = await detector.send({ image: video });
        detections = result?.detections ?? [];
      } catch (e) {
        console.warn('[FacePresence] Detection error:', e);
        // Frame skipped — don't count as absence
        return;
      }

      // Check whether any detected face matches the registered login face
      const matched = detections.some(d => {
        const box = d.boundingBox;
        if (!box) return false;
        return iou(login, box) >= IOU_THRESHOLD;
      });

      if (matched) {
        if (absentSinceRef.current !== null)
          console.log('[FacePresence] Face detected again — resetting absence timer');
        absentSinceRef.current = null;
      } else {
        if (absentSinceRef.current === null) {
          absentSinceRef.current = Date.now();
          console.log('[FacePresence] Face no longer detected — absence timer started');
        } else if (!firedRef.current &&
                   Date.now() - absentSinceRef.current >= ABSENCE_TIMEOUT_MS) {
          firedRef.current = true;
          console.log('[FacePresence] Absence timeout reached — triggering onFaceLeft');
          onFaceLeft?.();
        }
      }
    }, DETECTION_INTERVAL_MS);

    return () => clearInterval(intervalRef.current);
  }, [enabled, onFaceLeft, videoRef]);

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Retries until the shared detector is ready (up to REGISTER_RETRY_TIMEOUT_MS)
   * AND a face is visible. Safe to call immediately after login.
   */
  const registerLoginFace = useCallback(() => {
    return new Promise((resolve) => {
      const deadline = Date.now() + REGISTER_RETRY_TIMEOUT_MS;

      const attempt = async () => {
        const video    = videoRef.current;
        // Always pull from window in case HandTrackingService set it after
        // our init effect already ran its polling loop.
        const detector = detectorRef.current ?? window.__sharedFaceDetector ?? null;
        if (detector && !detectorRef.current) detectorRef.current = detector;

        if (!video || !detector) {
          if (Date.now() < deadline) {
            setTimeout(attempt, REGISTER_RETRY_INTERVAL_MS);
          } else {
            console.warn('[FacePresence] registerLoginFace — detector never became ready');
            resolve(false);
          }
          return;
        }

        try {
          const result     = await detector.send({ image: video });
          const detections = result?.detections ?? [];

          if (!detections.length) {
            if (Date.now() < deadline) {
              setTimeout(attempt, REGISTER_RETRY_INTERVAL_MS);
            } else {
              console.warn('[FacePresence] registerLoginFace — no face detected within timeout');
              resolve(false);
            }
            return;
          }

          // Pick the largest face (most likely the user standing in front of the mirror)
          const best = detections.reduce((a, b) => {
            const aArea = (a.boundingBox?.width ?? 0) * (a.boundingBox?.height ?? 0);
            const bArea = (b.boundingBox?.width ?? 0) * (b.boundingBox?.height ?? 0);
            return bArea > aArea ? b : a;
          });

          loginFaceRef.current   = best.boundingBox;
          absentSinceRef.current = null;
          firedRef.current       = false;
          console.log('[FacePresence] Login face registered ✓', {
            xCenter: best.boundingBox.xCenter,
            yCenter: best.boundingBox.yCenter,
            width:   best.boundingBox.width,
            height:  best.boundingBox.height,
          });
          resolve(true);
        } catch (e) {
          console.error('[FacePresence] registerLoginFace error:', e);
          resolve(false);
        }
      };

      attempt();
    });
  }, [videoRef]);

  /** Call on logout to wipe stored face and reset state. */
  const clearLoginFace = useCallback(() => {
    loginFaceRef.current   = null;
    absentSinceRef.current = null;
    firedRef.current       = false;
  }, []);

  return { registerLoginFace, clearLoginFace };
}