import { useEffect, useState } from "react";
import "/src/styles/WetterWidget.css";

const LOCATION = "Brixen";

const TAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export default function WetterWidget() {
    const [weather, setWeather] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetch(`http://localhost:3000/weather?q=${LOCATION}`)
            .then((r) => {
                if (!r.ok) throw new Error("API-Fehler");
                return r.json();
            })
            .then((data) => setWeather(data))
            .catch(() => setError("Fehler"));
    }, []);

    return (
        <div className="widget-body">
            <span className="widget-label">Wetter</span>
            <div className="wetter-inner">
                {error ? (
                    <span className="wetter-error">{error}</span>
                ) : !weather ? (
                    <span className="wetter-loading">Lädt…</span>
                ) : (
                    <>
                        <div className="wetter-top">
                            <img
                                className="wetter-icon"
                                src={"https:" + weather.current.condition.icon}
                                alt={weather.current.condition.text}
                            />
                            <span className="wetter-temp">
                                {Math.round(weather.current.temp_c)}°
                            </span>
                        </div>
                        <span className="wetter-desc">
                            {weather.current.condition.text}
                        </span>
                        <span className="wetter-location">
                            {weather.location.name}
                        </span>

                        <div className="wetter-forecast">
                            {weather.forecast.forecastday.map((day) => {
                                const datum = new Date(day.date);
                                const tagName = TAGE[datum.getDay()];
                                return (
                                    <div className="wetter-day" key={day.date}>
                                        <span className="wetter-day-name">{tagName}</span>
                                        <img
                                            className="wetter-day-icon"
                                            src={"https:" + day.day.condition.icon}
                                            alt={day.day.condition.text}
                                        />
                                        <span className="wetter-day-max">
                                            {Math.round(day.day.maxtemp_c)}°
                                        </span>
                                        <span className="wetter-day-min">
                                            {Math.round(day.day.mintemp_c)}°
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}