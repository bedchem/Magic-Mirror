import 'dotenv/config';
import express from 'express';

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
  next();
});

app.get('/weather', async (req, res) => {
  const location = req.query.q || 'Brixen';
  try {
    const response = await fetch(
      `https://api.weatherapi.com/v1/forecast.json?key=${process.env.VITE_WEATHER_API_KEY}&q=${location}&days=7&lang=de`
    );
    if (!response.ok) throw new Error(`WeatherAPI ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('WeatherAPI Fehler:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/stocks', async (req, res) => {
  const tickers = (req.query.tickers || 'AAPL,MSFT,NVDA,AMZN').split(',');
  const key = process.env.VITE_STOCKS_API_KEY;
  try {
    const results = await Promise.all(
      tickers.map(async (ticker) => {
        const url = `https://api.massive.com/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${key}`;
        const r = await fetch(url);
        const data = await r.json();
        if (!r.ok) throw new Error(`${ticker}: ${data.message || r.status}`);
        const result = data.results?.[0];
        return {
          ticker,
          close: result?.c ?? null,
          open: result?.o ?? null,
          high: result?.h ?? null,
          low: result?.l ?? null,
          change_percent:
            result?.o && result?.c
              ? ((result.c - result.o) / result.o) * 100
              : null
        };
      })
    );
    res.json(results);
  } catch (error) {
    console.error('StocksAPI Fehler:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('Server läuft auf http://localhost:3000');
});