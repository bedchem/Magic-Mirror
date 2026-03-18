import { useState, useEffect, useLayoutEffect, useRef } from "react";
import "/src/styles/DatetimeWidget.css";

const TZ = "Europe/Berlin";

function getTime() {
  const now = new Date();
  const opt = (opts) =>
    new Intl.DateTimeFormat("de-DE", { timeZone: TZ, ...opts }).format(now);

  const h = parseInt(opt({ hour: "2-digit", hour12: false }), 10);
  const m = parseInt(opt({ minute: "2-digit" }), 10);
  const s = parseInt(opt({ second: "2-digit" }), 10);

  return {
    h: String(isNaN(h) ? 0 : h).padStart(2, "0"),
    m: String(isNaN(m) ? 0 : m).padStart(2, "0"),
    s: isNaN(s) ? 0 : s,
    day: opt({ weekday: "long" }),
    date: opt({ day: "2-digit", month: "long", year: "numeric" }),
  };
}

function FlipDigit({ value, small }) {
  const prev = useRef(value);
  const [key, setKey] = useState(0);
  const [outVal, setOutVal] = useState(value);

  useLayoutEffect(() => {
    if (value !== prev.current) {
      setOutVal(prev.current);
      setKey(k => k + 1);
      prev.current = value;
    }
  }, [value]);

  const display = String(value).padStart(2, "0");
  const out = String(outVal).padStart(2, "0");

  return (
    <div className={`dt-flip${small ? " dt-flip--sm" : ""}`}>
      <span className="dt-flip__ghost" aria-hidden="true">{display}</span>
      <span key={`o${key}`} className="dt-flip__out" aria-hidden="true">{out}</span>
      <span key={`i${key}`} className="dt-flip__in">{display}</span>
    </div>
  );
}

export default function DatetimeWidget() {
  const [t, setT] = useState(getTime);

  useEffect(() => {
    const id = setInterval(() => setT(getTime()), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="dt-widget">
      <div className="dt-date-row">
        <span className="dt-day">{t.day}</span>
        <span className="dt-date">{t.date}</span>
      </div>

      <div className="dt-clock">
        <FlipDigit value={t.h} />
        <span className="dt-colon">:</span>
        <FlipDigit value={t.m} />
        <span className="dt-colon dt-colon--dim">:</span>
        <FlipDigit value={t.s} small />
      </div>
    </div>
  );
}