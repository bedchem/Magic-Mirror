import "/src/styles/KalenderWidget.css";
import { useState } from "react";

export default function KalenderWidget() {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthNames = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  const dayNames = ["Mo","Di","Mi","Do","Fr","Sa","So"];

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(d);

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const isToday = (d) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  return (
    <div className="widget-body">
      <span className="widget-label">Kalender</span>

      <div className="kal-root">
        <div className="kal-header">
          <button className="kal-nav" onClick={prevMonth}>‹</button>
          <span className="kal-title">{monthNames[month]} {year}</span>
          <button className="kal-nav" onClick={nextMonth}>›</button>
        </div>

        <div className="kal-grid">
          {dayNames.map(d => (
            <span key={d} className="kal-dow">{d}</span>
          ))}
          {cells.map((d, i) => (
            <span
              key={i}
              className={`kal-day ${d === null ? "kal-empty" : ""} ${d && isToday(d) ? "kal-today" : ""}`}
            >
              {d ?? ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}