import { useEffect, useState, useCallback, useRef } from "react";
import "/src/styles/NewsWidget.css";

const API_URL = "https://www.tagesschau.de/api2u/news";

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 60) return `vor ${diff} Min.`;
  if (diff < 1440) return `vor ${Math.floor(diff / 60)} Std.`;
  return `vor ${Math.floor(diff / 1440)} Tagen`;
}

function ArticleModal({ article, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="nw-modal-backdrop" onClick={onClose}>
      <div className="nw-modal" onClick={(e) => e.stopPropagation()}>
        <button className="nw-modal-close" onClick={onClose}>✕</button>

        {article.urlToImage && (
          <img
            src={article.urlToImage}
            alt={article.title}
            className="nw-modal-image"
          />
        )}

        <div className="nw-modal-body">
          <div className="nw-card-meta">
            <span className="nw-card-source">{article.source}</span>
            <span className="nw-card-time">{timeAgo(article.publishedAt)}</span>
          </div>

          <h2 className="nw-modal-title">{article.title}</h2>

          {article.description && (
            <p className="nw-modal-desc">{article.description}</p>
          )}


        </div>
      </div>
    </div>
  );
}

function ArticleCard({ article, onClick }) {
  return (
    <div className="nw-card" data-nw-article-index={article.index} onClick={() => onClick(article)}>
      {article.urlToImage && (
        <img
          src={article.urlToImage}
          alt={article.title}
          className="nw-card-image"
          loading="lazy"
        />
      )}

      <div className="nw-card-body">
        <div className="nw-card-meta">
          <span className="nw-card-source">{article.source}</span>
          <span className="nw-card-time">{timeAgo(article.publishedAt)}</span>
        </div>

        <h2 className="nw-card-title">{article.title}</h2>

        {article.description && (
          <p className="nw-card-desc">{article.description}</p>
        )}
      </div>
    </div>
  );
}

export default function NewsWidget({ handPositions = {} }) {
  const [articles, setArticles] = useState([]);
  const [status, setStatus] = useState("loading");
  const [selected, setSelected] = useState(null);
  const listRef = useRef(null);
  const prevYRef = useRef({});
  const activeScrollRef = useRef({});
  const wasPinchingRef = useRef({});

  const fetchNews = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error();

      const data = await res.json();

      const mapped = data.news.map((a, index) => ({
        index,
        title: a.title,
        description: a.teaser,
        url: a.detailsweb,
        urlToImage:
          a.teaserImage?.imageVariants?.["16x9-512"] ||
          a.teaserImage?.imageVariants?.["16x9-256"],
        publishedAt: a.date,
        source: "Tagesschau",
      }));

      setArticles(mapped);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  useEffect(() => {
    for (const pos of Object.values(handPositions)) {
      const {
        handIndex, detected, palmVisible, isPinching,
        pinchMidX, pinchMidY, x, y,
      } = pos;

      const wasPinching = Boolean(wasPinchingRef.current[handIndex]);

      const tx = x ?? pinchMidX;
      const ty = y ?? pinchMidY;

      if (!detected || palmVisible === false || !isPinching) {
        activeScrollRef.current[handIndex] = false;
        prevYRef.current[handIndex] = null;
        wasPinchingRef.current[handIndex] = false;
        continue;
      }

      if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
        wasPinchingRef.current[handIndex] = isPinching;
        continue;
      }

      const cx = Math.max(0, Math.min(window.innerWidth - 1, tx));
      const cy = Math.max(0, Math.min(window.innerHeight - 1, ty));
      const els = document.elementsFromPoint(cx, cy);
      const overList = els.some(
        (el) => el === listRef.current || el.closest?.(".nw-list")
      );

      if (!wasPinching && status === "success" && !selected) {
        const cardEl = els.find(
          (el) => el.classList?.contains("nw-card") || el.closest?.(".nw-card")
        );
        const card = cardEl?.closest?.(".nw-card") ?? cardEl;
        const articleIndex = Number(card?.dataset?.nwArticleIndex);
        if (Number.isInteger(articleIndex) && articles[articleIndex]) {
          setSelected(articles[articleIndex]);
          activeScrollRef.current[handIndex] = false;
          prevYRef.current[handIndex] = null;
          wasPinchingRef.current[handIndex] = true;
          continue;
        }
      }

      if (!activeScrollRef.current[handIndex]) {
        if (!overList) {
          prevYRef.current[handIndex] = null;
          wasPinchingRef.current[handIndex] = isPinching;
          continue;
        }
        activeScrollRef.current[handIndex] = true;
        prevYRef.current[handIndex] = ty;
        wasPinchingRef.current[handIndex] = isPinching;
        continue;
      }

      const py = prevYRef.current[handIndex];
      if (py != null && listRef.current) {
        const delta = py - ty;
        if (Math.abs(delta) > 0.8) listRef.current.scrollTop += delta;
      }
      prevYRef.current[handIndex] = ty;
      wasPinchingRef.current[handIndex] = isPinching;
    }
  }, [articles, handPositions, selected, status]);

  return (
    <div className="nw-widget">
      <div className="nw-header">
        <p className="nw-header-label">LIVE FEED</p>
        <h1 className="nw-header-title">Tagesschau</h1>
        <button className="nw-refresh-btn" onClick={fetchNews}>
          ↻ Aktualisieren
        </button>
      </div>

      {status === "loading" && (
        <div className="nw-state">
          <div className="nw-spinner" />
          <p className="nw-state-text">Nachrichten werden geladen…</p>
        </div>
      )}

      {status === "error" && (
        <div className="nw-state">
          <p className="nw-state-error">⚠ Fehler beim Laden.</p>
          <span className="nw-retry" onClick={fetchNews}>
            Erneut versuchen
          </span>
        </div>
      )}

      {status === "success" && (
        <div className="nw-list" ref={listRef}>
          {articles.map((article, i) => (
            <ArticleCard key={i} article={article} onClick={setSelected} />
          ))}
        </div>
      )}

      {selected && (
        <ArticleModal article={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}