import { useEffect, useState } from "react";
import "/src/styles/StocksWidget.css";

const DEFAULT_TICKERS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN"];

export default function StocksWidget() {
  const [stocks, setStocks] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`http://localhost:3000/stocks?tickers=${DEFAULT_TICKERS.join(",")}`)
      .then((r) => {
        if (!r.ok) throw new Error("API-Fehler");
        return r.json();
      })
      .then((data) => setStocks(data))
      .catch(() => setError("Fehler"));
  }, []);

  return (
    <div className="widget-body">
      <span className="widget-label">Stocks</span>
      <div className="stocks-inner">
        {error ? (
          <span className="stocks-error">{error}</span>
        ) : stocks.length === 0 ? (
          <span className="stocks-loading">Lädt…</span>
        ) : (
          stocks.map((s) => {
            const up = s.change_percent >= 0;
            return (
              <div className="stocks-row" key={s.ticker}>
                <span className="stocks-ticker">{s.ticker}</span>
                <span className="stocks-price">
                  {s.close != null ? `$${s.close.toFixed(2)}` : "–"}
                </span>
                <span className={`stocks-change ${up ? "up" : "down"}`}>
                  {s.change_percent != null
                    ? `${up ? "+" : ""}${s.change_percent.toFixed(2)}%`
                    : "–"}
                </span>
              </div>
            );
          })
        )}
        <span className="stocks-hint">Vortagskurs (EOD)</span>
      </div>
    </div>
  );
}