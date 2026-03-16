import { useState, useEffect, useCallback } from "react";
import "/src/styles/StundenplanWidget.css";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr"];

const PERIODS = [
    { n: 1, start: "07:50", end: "08:40" },
    { n: 2, start: "08:40", end: "09:30" },
    { n: 3, start: "09:30", end: "10:20" },
    { n: 4, start: "10:35", end: "11:25" },
    { n: 5, start: "11:25", end: "12:15" },
    { n: 6, start: "12:15", end: "13:05" },
    { n: 7, start: "13:15", end: "14:05" },
    { n: 8, start: "14:05", end: "14:55" }
];

const DAY_COLORS = {
    Mo: { bg: "rgba(29,158,117,0.13)", acc: "#1d9e75" },
    Di: { bg: "rgba(127,119,221,0.13)", acc: "#8880e8" },
    Mi: { bg: "rgba(212,83,126,0.13)", acc: "#d4537e" },
    Do: { bg: "rgba(55,138,221,0.13)", acc: "#378add" },
    Fr: { bg: "rgba(212,148,30,0.13)", acc: "#d4940e" }
};

const DEFAULT_TIMETABLE = {
    Mo: [
        { period: 1, subj: "Te-Da", detail: "R", room: "c+2/03" },
        { period: 2, subj: "Wi-He", detail: "ENGL", room: "c+2/03" },
        { period: 3, subj: "Pu-Ma", detail: "IT", room: "c+2/03" },
        { period: 4, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 5, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 7, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 8, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 9, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" }
    ],
    Di: [
        { period: 1, subj: "Pr-Ma, Pu-Ma", detail: "IT", room: "c+2/03" },
        { period: 2, subj: "Pr-Ma, Pu-Ma", detail: "IT", room: "c+2/03" },
        { period: 3, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 4, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 5, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 6, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" }
    ],
    Mi: [
        { period: 1, subj: "Pe-Cl", detail: "M", room: "c+2/03" },
        { period: 2, subj: "Pr-Ma, Sch-Fi", detail: "D", room: "c+2/03" },
        { period: 3, subj: "Fe-De", detail: "Bew.Sport", room: "Tu I" },
        { period: 4, subj: "Fe-De", detail: "Bew.Sport", room: "Tu I" },
        { period: 5, subj: "Sch-Fi", detail: "Re-Wiku", room: "c+2/03" },
        { period: 7, subj: "Kü-Ge", detail: "M8", room: "E-Lab, Inf II" },
        { period: 8, subj: "Kü-Ge", detail: "M8", room: "E-Lab, Inf II" },
        { period: 9, subj: "Kü-Ge", detail: "M8", room: "E-Lab, Inf II" }
    ],
    Do: [
        { period: 1, subj: "Wi-He", detail: "ENGL", room: "c+2/03" },
        { period: 2, subj: "Wi-He", detail: "ENGL", room: "c+2/03" },
        { period: 3, subj: "Sch-Fi", detail: "Re-Wiku", room: "c+2/03" },
        { period: 4, subj: "Sch-Fi", detail: "M8", room: "E-Lab, Inf II", change: true },
        { period: 5, subj: "Kü-Ge", detail: "M8", room: "E-Lab, Inf II" },
        { period: 7, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 8, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 9, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" },
        { period: 10, subj: "Pr-Ge", detail: "M5-M7", room: "Inf III" }
    ],
    Fr: [
        { period: 1, subj: "Wi-He", detail: "ENGL", room: "c+2/03" },
        { period: 2, subj: "Sch-Fi", detail: "D", room: "c+2/03" },
        { period: 3, subj: "Sch-Fi", detail: "D", room: "c+2/03" },
        { period: 4, subj: "Pe-Cl", detail: "M", room: "c+2/03" },
        { period: 5, subj: "Pe-Cl", detail: "M", room: "c+2/03" }
    ]
};

const p2 = (n) => String(n).padStart(2, "0");

const toM = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
};

const getMon = (off) => {
    const n = new Date();
    const d = n.getDay() || 7;

    const m = new Date(n);
    m.setDate(n.getDate() - d + 1 + off * 7);
    m.setHours(0, 0, 0, 0);

    return m;
};

const fmt = (d) => p2(d.getDate()) + "." + p2(d.getMonth() + 1) + ".";

function NowLine({ period, ci, tci }) {
    const [pct, setPct] = useState(null);

    useEffect(() => {
        const u = () => {
            const n = new Date();
            const nm = n.getHours() * 60 + n.getMinutes();

            const s = toM(period.start);
            const e = toM(period.end);

            setPct(ci === tci && nm >= s && nm <= e ? ((nm - s) / (e - s)) * 100 : null);
        };

        u();

        const id = setInterval(u, 30000);
        return () => clearInterval(id);
    }, [period, ci, tci]);

    if (pct === null) return null;

    return (
        <div className="sp-now-line" style={{ top: `${pct}%` }}>
            <div className="sp-now-dot" />
        </div>
    );
}

function Lesson({ l, onEdit }) {
    const c = DAY_COLORS[l.day];

    const bg = l.entfall
        ? "rgba(192,57,43,0.18)"
        : l.change
            ? "rgba(29,158,117,0.18)"
            : c.bg;

    const acc = l.entfall ? "#c0392b" : l.change ? "#1d9e75" : c.acc;

    return (
        <div
            className={`sp-lesson${l.entfall ? " entfall" : ""}`}
            style={{ background: bg, borderLeftColor: acc }}
            onClick={() => onEdit(l)}
        >
            <div className="sp-lesson-subj">
                {l.subj}
                {l.change && <span className="sp-badge-change" />}
                {l.pruef && <span className="sp-badge-pruef" />}
            </div>

            <div className="sp-lesson-meta">
                {l.detail} · {l.room}
            </div>
        </div>
    );
}

export default function Stundenplan() {

    const [off, setOff] = useState(0);

    const [timetable, setTT] = useState(DEFAULT_TIMETABLE);

    const [clk, setClk] = useState("");

    const [editing, setEditing] = useState(null);

    const [slide, setSlide] = useState("active");

    useEffect(() => {

        const tick = () => {

            const n = new Date();

            setClk(
                `${p2(n.getHours())}:${p2(n.getMinutes())}:${p2(n.getSeconds())}`
            );

        };

        tick();

        const id = setInterval(tick, 1000);

        return () => clearInterval(id);

    }, []);

    const navigate = useCallback((dir) => {

        setSlide(dir > 0 ? "exit-left" : "exit-right");

        setTimeout(() => {

            setOff((o) => o + dir);

            setSlide(dir > 0 ? "enter-right" : "enter-left");

            requestAnimationFrame(() =>
                requestAnimationFrame(() => setSlide("active"))
            );

        }, 200);

    }, []);

    const mon = getMon(off);
    const fri = new Date(mon);

    fri.setDate(mon.getDate() + 4);

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const tci = off === 0 ? (today.getDay() === 0 ? -1 : today.getDay() - 1) : -1;

    return (
        <div className="sp">

            <div className="sp-header">

                <button className="sp-nav" onClick={() => navigate(-1)}>‹</button>

                <div className="sp-header-center">
                    <span className="sp-week">
                        {fmt(mon)} – {fmt(fri)} {fri.getFullYear()}
                    </span>

                    <span className="sp-clock">{clk}</span>
                </div>

                <button className="sp-nav" onClick={() => navigate(1)}>›</button>

            </div>

            <div className="sp-body">

                <div className={`sp-slide ${slide}`}>

                    <div className="sp-table">

                        <div className="sp-days-row">

                            <div className="sp-time-spacer" />

                            {DAYS.map((d, i) => {

                                const date = new Date(mon);
                                date.setDate(mon.getDate() + i);

                                const isT = i === tci;

                                return (
                                    <div key={d} className="sp-day-head">

                                        <span className="sp-day-name">{d}</span>

                                        {isT ? (
                                            <span className="sp-day-today">{date.getDate()}</span>
                                        ) : (
                                            <span className="sp-day-date">
                                                {p2(date.getDate())}.{p2(date.getMonth() + 1)}.
                                            </span>
                                        )}

                                    </div>
                                );

                            })}

                        </div>

                        <div className="sp-periods-wrap">

                            {PERIODS.map((p) => (

                                <div key={p.n} className="sp-period-row">

                                    <div className="sp-time-cell">
                                        <span className="sp-period-num">{p.n}.</span>
                                        <span className="sp-period-start">{p.start}</span>
                                    </div>

                                    {DAYS.map((d, di) => {

                                        const lessons =
                                            (timetable[d] || []).filter((l) => l.period === p.n);

                                        return (
                                            <div key={d} className="sp-day-cell">

                                                {lessons.map((l, li) => (
                                                    <Lesson key={li} l={{ ...l, day: d }} onEdit={setEditing} />
                                                ))}

                                                <NowLine period={p} ci={di} tci={tci} />

                                            </div>
                                        );

                                    })}

                                </div>

                            ))}

                        </div>

                    </div>

                </div>

            </div>

        </div>
    );
}