import { useCallback, useEffect, useRef, useState } from "react";
import "/src/styles/StocksWidget.css";

const FALLBACK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA", "BINANCE:BTCUSDT", "BINANCE:ETHUSDT"];
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const UI_UPDATE_INTERVAL_MS = 800;
const HISTORY_MS_1H = 60 * 60 * 1000;
const TIMEFRAMES = ["LIVE", "1H", "1D"];

function makeEmptyEntry(symbol) {
  return {
    symbol,
    price: null,
    prevPrice: null,
    changeLive: null,
    change1h: null,
    change1d: null,
    history: [],
  };
}

function percentDiff(from, to) {
  if (typeof from !== "number" || typeof to !== "number" || from === 0) return null;
  return ((to - from) / from) * 100;
}

function rowsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.symbol !== y.symbol ||
      x.price !== y.price ||
      x.changeLive !== y.changeLive ||
      x.change1h !== y.change1h ||
      x.change1d !== y.change1d
    ) {
      return false;
    }
  }
  return true;
}

export default function StocksWidget({ handPositions = {} }) {
  const [stocks, setStocks] = useState([]);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState("1D");

  const listRef = useRef(null);
  const prevPinch = useRef({});
  const prevYRef = useRef({});
  const activeScrollRef = useRef({});

  useEffect(() => {
    let socket = null;
    let activeSymbols = [...FALLBACK_SYMBOLS];
    let flushTimer = null;
    const symbolMap = new Map();

    const flushToUi = () => {
      const nextRows = activeSymbols.map((symbol) => {
        const entry = symbolMap.get(symbol) || makeEmptyEntry(symbol);
        return {
          symbol,
          price: entry.price,
          changeLive: entry.changeLive,
          change1h: entry.change1h,
          change1d: entry.change1d,
        };
      });

      setStocks((prev) => (rowsEqual(prev, nextRows) ? prev : nextRows));
    };

    const upsertQuote = (symbol, nextPrice) => {
      const prev = symbolMap.get(symbol) || makeEmptyEntry(symbol);
      const price = typeof nextPrice === "number" ? nextPrice : prev.price;
      const now = Date.now();
      const history = [...prev.history, { t: now, p: price }].filter(
        (point) => now - point.t <= HISTORY_MS_1H && typeof point.p === "number"
      );
      const hourBaseline = history.length > 0 ? history[0].p : null;

      symbolMap.set(symbol, {
        ...prev,
        symbol,
        prevPrice: prev.price,
        price,
        changeLive: percentDiff(prev.price, price),
        change1h: percentDiff(hourBaseline, price),
        history,
      });
    };

    const initSocket = async () => {
      try {
        setError(null);
        const configRes = await fetch(`${API_BASE}/stocks/config`);
        if (!configRes.ok) {
          const details = await configRes.json().catch(() => null);
          throw new Error(details?.error || "Config konnte nicht geladen werden");
        }

        const config = await configRes.json();
        if (!config?.wsUrl) throw new Error("Fehlende Finnhub-Konfiguration");

        if (Array.isArray(config.symbols) && config.symbols.length > 0) {
          activeSymbols = config.symbols;
        }

        activeSymbols.forEach((symbol) => {
          symbolMap.set(symbol, makeEmptyEntry(symbol));
        });
        flushToUi();

        const quoteRes = await fetch(`${API_BASE}/stocks/quotes`);
        if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          if (Array.isArray(quoteData)) {
            quoteData.forEach((q) => {
              if (!q?.symbol) return;
              const prev = symbolMap.get(q.symbol) || makeEmptyEntry(q.symbol);
              symbolMap.set(q.symbol, {
                ...prev,
                symbol: q.symbol,
                price: typeof q.price === "number" ? q.price : null,
                change1d: typeof q.change_percent === "number" ? q.change_percent : null,
              });
            });
            flushToUi();
          }
        }

        socket = new WebSocket(config.wsUrl);

        socket.addEventListener("open", () => {
          activeSymbols.forEach((symbol) => {
            socket.send(JSON.stringify({ type: "subscribe", symbol }));
          });
        });

        socket.addEventListener("message", (event) => {
          const payload = JSON.parse(event.data);

          if (payload?.type === "error" && payload?.msg) {
            setError(`Finnhub: ${payload.msg}`);
            return;
          }

          if (!payload?.data || !Array.isArray(payload.data)) return;

          payload.data.forEach((trade) => {
            const symbol = trade?.s;
            if (!symbol) return;
            upsertQuote(symbol, trade.p);
          });
        });

        socket.addEventListener("error", () => {
          setError("WebSocket-Fehler");
        });

        flushTimer = setInterval(flushToUi, UI_UPDATE_INTERVAL_MS);
      } catch (err) {
        console.error("Stocks Widget Fehler:", err);
        setError(err?.message || "Fehler beim Verbinden");
      }
    };

    initSocket();

    return () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        activeSymbols.forEach((symbol) => {
          socket.send(JSON.stringify({ type: "unsubscribe", symbol }));
        });
      }
      socket?.close();
      if (flushTimer) clearInterval(flushTimer);
    };
  }, []);

  const isPointInList = useCallback((x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (!listRef.current) return false;
    const hits = document.elementsFromPoint(x, y);
    return hits.some((el) => el === listRef.current || el.closest?.(".stocks-list-scroll"));
  }, []);

  useEffect(() => {
    for (const pos of Object.values(handPositions)) {
      const { handIndex, detected, palmVisible, isPinching, x, y, pinchMidX, pinchMidY } = pos;
      const tx = x ?? pinchMidX;
      const ty = y ?? pinchMidY;
      const wasPinching = prevPinch.current[handIndex];

      if (!detected || palmVisible === false || !isPinching) {
        prevPinch.current[handIndex] = false;
        prevYRef.current[handIndex] = null;
        activeScrollRef.current[handIndex] = false;
        continue;
      }

      if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
        prevPinch.current[handIndex] = true;
        continue;
      }

      if (!wasPinching) {
        activeScrollRef.current[handIndex] = isPointInList(tx, ty);
        prevYRef.current[handIndex] = ty;
        prevPinch.current[handIndex] = true;
        continue;
      }

      if (activeScrollRef.current[handIndex] && listRef.current) {
        const py = prevYRef.current[handIndex];
        if (py != null) {
          const deltaY = py - ty;
          if (Math.abs(deltaY) > 0.8) {
            listRef.current.scrollTop += deltaY;
          }
        }
      }
      prevYRef.current[handIndex] = ty;

      prevPinch.current[handIndex] = true;
    }
  }, [handPositions, isPointInList]);

  const formatChange = useCallback((row) => {
    if (timeframe === "LIVE") return row.changeLive;
    if (timeframe === "1H") return row.change1h;
    return row.change1d;
  }, [timeframe]);

  return (
    <div className="widget-body stocks-widget">
      <span className="widget-label">Stocks</span>
      <div className="stocks-controls">
        <div className="stocks-timeframe-view">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className="stocks-chip"
              data-active={timeframe === tf}
            >
              {tf === "LIVE" ? "Last Tick" : tf === "1H" ? "Last Hour" : "Last Day"}
            </button>
          ))}
        </div>
      </div>
      <div
        className="stocks-inner"
      >
        {error ? (
          <span className="stocks-error">{error}</span>
        ) : stocks.length === 0 ? (
          <span className="stocks-loading">Verbinde...</span>
        ) : (
          <div className="stocks-list stocks-list-scroll" ref={listRef}>
            {stocks.map((s) => {
              const currentChange = formatChange(s);
              const up = (currentChange ?? 0) >= 0;
              return (
                <div className="stocks-row" key={s.symbol}>
                  <span className="stocks-ticker">{s.symbol}</span>
                  <span className="stocks-price">
                    {s.price != null ? `$${s.price.toFixed(2)}` : "-"}
                  </span>
                  <span className={`stocks-change ${up ? "up" : "down"}`}>
                    {currentChange != null
                      ? `${up ? "+" : ""}${currentChange.toFixed(2)}%`
                      : "-"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="stocks-footer">
          <span className="stocks-hint">
            Scroll symbols
          </span>
          <span className="stocks-hint">Finnhub</span>
        </div>
      </div>
    </div>
  );
}