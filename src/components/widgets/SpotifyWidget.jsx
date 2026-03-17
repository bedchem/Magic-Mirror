// for this to work without mouse: & "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --autoplay-policy=no-user-gesture-required --kiosk http://localhost:5173

import { useEffect, useRef, useState } from 'react';
import '/src/styles/SpotifyWidget.css';

export default function SpotifyWidget() {
  const [link, setLink] = useState(null);
  const [links, setLinks] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef(null);
  const intervalRef = useRef(null);
  const selectedUrlStorageKey = 'spotifyWidget.selectedUrl';
  const selectedLinkStorageKey = 'spotifyWidget.selectedLink';
  const pausedPositionsStorageKey = 'spotifyWidget.pausedPositions';
  const pendingAutoPlayRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const switchTokenRef = useRef(0);
  const isPlayingRef = useRef(false);
  const iframeReadyRef = useRef(false);
  const pausedPositionsRef = useRef({});
  const playRetryTimeoutRef = useRef(null);
  const switchFallbackTimeoutRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    try {
      const pausedRaw = window.localStorage.getItem(pausedPositionsStorageKey);
      pausedPositionsRef.current = pausedRaw ? JSON.parse(pausedRaw) : {};
    } catch (e) {
      console.error('Spotify paused positions parse Fehler:', e);
      pausedPositionsRef.current = {};
    }

    try {
      const cachedRaw = window.localStorage.getItem(selectedLinkStorageKey);
      const cached = cachedRaw ? JSON.parse(cachedRaw) : null;
      if (cached?.url) {
        setLink(cached);
        setHistory([cached.url]);
        setHistoryIndex(0);
        setLoading(false);
      }
    } catch (e) {
      console.error('Spotify cache parse Fehler:', e);
    }

    async function fetchLinks() {
      try {
        const res = await fetch('http://localhost:3000/api/spotify-links');
        const data = await res.json();
        if (!cancelled && data.length > 0) {
          setLinks(data);

          const storedUrl = window.localStorage.getItem(selectedUrlStorageKey);
          const storedMatch = storedUrl ? data.find((item) => item.url === storedUrl) : null;
          const selected = storedMatch ?? data[Math.floor(Math.random() * data.length)];

          setLink(selected);

          if (selected?.url) {
            window.localStorage.setItem(selectedUrlStorageKey, selected.url);
            window.localStorage.setItem(selectedLinkStorageKey, JSON.stringify(selected));
            setHistory((prev) => (prev.length > 0 ? prev : [selected.url]));
            setHistoryIndex((prev) => (prev > 0 ? prev : 0));
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchLinks();

    function onMessage(e) {
      if (e.origin !== 'https://open.spotify.com') return;
      const d = typeof e.data === 'string'
        ? (() => {
            try { return JSON.parse(e.data); } catch { return null; }
          })()
        : e.data;

      if (!d) return;

      if (d?.type === 'ready') {
        if (!iframeReadyRef.current) {
          iframeReadyRef.current = true;
          setIframeReady(true);
        }
      }

      if (d?.type === 'playback_update') {
        if (!iframeReadyRef.current) {
          iframeReadyRef.current = true;
          setIframeReady(true);
        }

        const pos = d.payload?.position ?? 0;
        const dur = d.payload?.duration ?? 0;
        setCurrentSec(Math.floor(pos / 1000));
        setDurationSec(Math.floor(dur / 1000));
        setProgress(dur > 0 ? (pos / dur) * 100 : 0);
        setIsPlaying(!d.payload?.isPaused);
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
    };
  }, []);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentSec(s => s + 1);
        setProgress(p => Math.min(p + (durationSec > 0 ? 100 / durationSec : 0), 100));
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, durationSec]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (iframeReady) {
      setIsSwitching(false);

      if (switchFallbackTimeoutRef.current) {
        clearTimeout(switchFallbackTimeoutRef.current);
        switchFallbackTimeoutRef.current = null;
      }

      if (pendingAutoPlayRef.current || pendingPlayRef.current) {
        pendingAutoPlayRef.current = false;
        pendingPlayRef.current = false;
        window.setTimeout(() => {
          sendPlayOnce();
          restorePausedPositionIfAvailable();
        }, 180);
      }
    }
  }, [iframeReady]);

  useEffect(() => {
    if (!iframeReady || !pendingPlayRef.current) return;

    pendingPlayRef.current = false;
    sendPlayOnce();
    restorePausedPositionIfAvailable();
  }, [iframeReady]);

  useEffect(() => () => {
    if (playRetryTimeoutRef.current) {
      clearTimeout(playRetryTimeoutRef.current);
    }

    if (switchFallbackTimeoutRef.current) {
      clearTimeout(switchFallbackTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    setIframeReady(false);
    iframeReadyRef.current = false;
  }, [link?.url]);

  function sendSpotifyCommand(command) {
    const payload = typeof command === 'string' ? { command } : command;
    iframeRef.current?.contentWindow?.postMessage(payload, 'https://open.spotify.com');
  }

  function sendSpotifyCommandWithRetry(command, delays = [0, 250, 700]) {
    delays.forEach((delay) => {
      window.setTimeout(() => {
        sendSpotifyCommand(command);
      }, delay);
    });
  }

  function sendPlayOnce() {
    sendSpotifyCommand('play');
  }

  function persistPausedPositions() {
    try {
      window.localStorage.setItem(pausedPositionsStorageKey, JSON.stringify(pausedPositionsRef.current));
    } catch (e) {
      console.error('Spotify paused positions speichern Fehler:', e);
    }
  }

  function savePausedPosition() {
    if (!link?.url) return;
    pausedPositionsRef.current[link.url] = currentSec;
    persistPausedPositions();
  }

  function restorePausedPositionIfAvailable() {
    if (!link?.url) return;
    const sec = pausedPositionsRef.current[link.url];
    if (!Number.isFinite(sec) || sec <= 0) return;

    const ms = Math.floor(sec * 1000);
    window.setTimeout(() => {
      sendSpotifyCommand({ command: 'seek', position_ms: ms });
      sendSpotifyCommand({ command: 'seek', position: ms });
    }, 220);
  }

  function resetPlaybackUi() {
    setIsPlaying(false);
    setProgress(0);
    setCurrentSec(0);
    setDurationSec(0);
  }

  function persistSelected(nextLink) {
    if (!nextLink?.url) return;
    window.localStorage.setItem(selectedUrlStorageKey, nextLink.url);
    window.localStorage.setItem(selectedLinkStorageKey, JSON.stringify(nextLink));
  }

  function getRandomLink(excludeUrl) {
    if (links.length === 0) return null;
    if (links.length === 1) return links[0];

    const pool = links.filter((item) => item.url !== excludeUrl);
    const richPool = pool.filter((item) => item?.title && item.title !== 'Unbekannt' && item?.cover);
    const preferredPool = richPool.length > 0 ? richPool : pool;
    const source = preferredPool.length > 0 ? preferredPool : links;
    return source[Math.floor(Math.random() * source.length)];
  }

  function switchToLink(nextLink, nextHistory, nextHistoryIndex) {
    if (!nextLink) return;

    const token = ++switchTokenRef.current;
    setIsSwitching(true);
    pendingAutoPlayRef.current = true;
    pendingPlayRef.current = false;

    sendSpotifyCommandWithRetry('pause', [0, 120]);

    if (switchFallbackTimeoutRef.current) {
      clearTimeout(switchFallbackTimeoutRef.current);
    }

    switchFallbackTimeoutRef.current = window.setTimeout(() => {
      if (token !== switchTokenRef.current) return;
      setIsSwitching(false);
      if (pendingAutoPlayRef.current) {
        pendingAutoPlayRef.current = false;
        sendPlayOnce();
      }
    }, 2500);

    window.setTimeout(() => {
      if (token !== switchTokenRef.current) return;

      setHistory(nextHistory);
      setHistoryIndex(nextHistoryIndex);
      setLink(nextLink);
      persistSelected(nextLink);
      resetPlaybackUi();
    }, 160);
  }

  function handleNextRandom() {
    if (isSwitching) return;

    const nextLink = getRandomLink(link?.url);
    if (!nextLink) return;

    const trimmed = history.slice(0, historyIndex + 1);
    const nextHistory = [...trimmed, nextLink.url];

    switchToLink(nextLink, nextHistory, nextHistory.length - 1);
  }

  function handlePreviousFromHistory() {
    if (historyIndex === 0 || isSwitching) return;

    const nextHistoryIndex = historyIndex - 1;
    const previousUrl = history[nextHistoryIndex];
    const previousLink = links.find((item) => item.url === previousUrl) ?? link;

    if (!previousLink) return;

    switchToLink(previousLink, history, nextHistoryIndex);
  }

  function handleIframeLoad() {
  }

  function handlePlayPause() {
    if (isSwitching) return;

    if (isPlaying) {
      savePausedPosition();
      sendSpotifyCommandWithRetry('pause', [0, 150]);
      return;
    }

    if (!iframeReady) {
      pendingPlayRef.current = true;
      return;
    }

    sendPlayOnce();
    restorePausedPositionIfAvailable();
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatRemaining(cur, dur) {
    const rem = Math.max(dur - cur, 0);
    return `-${formatTime(rem)}`;
  }

  function toEmbedUrl(url) {
    if (!url) return '';
    if (url.includes('/embed/')) return url;

    const trackId =
      url.match(/(?:open\.spotify\.com\/)track\/([a-zA-Z0-9]+)/)?.[1] ||
      url.match(/spotify:track:([a-zA-Z0-9]+)/)?.[1];

    if (!trackId) return url;
    return `https://open.spotify.com/embed/track/${trackId}`;
  }

  function parseTrackTitleAndArtist(title, artist) {
    if (artist && artist.trim().length > 0) {
      return { songTitle: title || 'Unbekannt', artistName: artist };
    }

    const safeTitle = title || 'Unbekannt';

    if (safeTitle.includes(' - ')) {
      const [song, ...rest] = safeTitle.split(' - ');
      return { songTitle: song || 'Unbekannt', artistName: rest.join(' - ') };
    }

    if (safeTitle.includes(' by ')) {
      const [song, ...rest] = safeTitle.split(' by ');
      return { songTitle: song || 'Unbekannt', artistName: rest.join(' by ') };
    }

    return { songTitle: safeTitle, artistName: '' };
  }

  if (loading || !link) {
    return (
      <div className="sp-widget sp-empty">
        <span>{loading ? 'Laden...' : 'Keine Songs gefunden.'}</span>
      </div>
    );
  }

  const { songTitle, artistName } = parseTrackTitleAndArtist(link.title, link.artist);
  const embedUrl = toEmbedUrl(link.url);

  return (
    <div className="sp-wrapper">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        onLoad={handleIframeLoad}
        width="1"
        height="1"
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        style={{ position: 'fixed', left: '-9999px', top: 0, opacity: 0, pointerEvents: 'none' }}
      />

      <div className="sp-widget">
        <div className="sp-cover-wrap">
          {link.cover
            ? <img src={link.cover} alt={songTitle} className="sp-cover" />
            : <div className="sp-cover sp-cover-placeholder" />
          }
        </div>

        <div className="sp-right">
          <div className="sp-titles">
            <span className="sp-title">{songTitle}</span>
            <span className="sp-artist">{artistName}</span>
          </div>

          <div className="sp-progress-wrap">
            <div className="sp-progress-bar">
              <div className="sp-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="sp-time-labels">
              <span>{formatTime(currentSec)}</span>
              <span>{durationSec > 0 ? formatRemaining(currentSec, durationSec) : '0:00'}</span>
            </div>
          </div>

          <div className="sp-controls">
            <button className="sp-btn" onClick={handlePreviousFromHistory} disabled={historyIndex === 0 || isSwitching}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm10 0v12l-8-6z"/>
              </svg>
            </button>

            <button className="sp-btn sp-btn-play" onClick={handlePlayPause} disabled={isSwitching}>
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            <button className="sp-btn" onClick={handleNextRandom} disabled={isSwitching}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8-6-8-6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
