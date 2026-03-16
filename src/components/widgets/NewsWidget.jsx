import { useEffect, useState, useCallback } from "react";
import "/src/styles/NewsWidget.css";

const API_URL = "https://www.tagesschau.de/api2u/news";

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 60) return `vor ${diff} Min.`;
  if (diff < 1440) return `vor ${Math.floor(diff / 60)} Std.`;
  return `vor ${Math.floor(diff / 1440)} Tagen`;
}

function ArticleCard({ article }) {
  return (
    <a href={article.url} target="_blank" rel="noreferrer" className="nw-card">
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
    </a>
  );
}

export default function NewsWidget() {
  const [articles, setArticles] = useState([]);
  const [status, setStatus] = useState("loading");

  const fetchNews = useCallback(async () => {
    setStatus("loading");

    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error();

      const data = await res.json();

      const mapped = data.news.map((a) => ({
        title: a.title,
        description: a.teaser,
        url: a.detailsweb,
        urlToImage:
          a.teaserImage?.imageVariants?.["16x9-512"] ||
          a.teaserImage?.imageVariants?.["16x9-256"],
        publishedAt: a.date,
        source: "Tagesschau"
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
        <div className="nw-list">
          {articles.map((article, i) => (
            <ArticleCard key={i} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}