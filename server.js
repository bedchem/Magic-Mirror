import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import cors from 'cors';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB } from './src/utils/db.js';
import { addSpotifyLink, getSpotifyLinks } from './src/utils/db.js';
import sharp from 'sharp';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '.env') });

await initDB();

const app = express();
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }
});

const FALLBACK_COMPLIMENTS = [
  'You have a great presence.',
  'You look fantastic today.',
  'Your smile is genuinely uplifting.',
  'You have a really positive vibe.',
  'You look confident and stylish.'
];

function getFallbackCompliment() {
  const index = Math.floor(Math.random() * FALLBACK_COMPLIMENTS.length);
  return FALLBACK_COMPLIMENTS[index];
}

app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static('public'));

function getFinnhubToken() {
  return (
    process.env.FINNHUB_API_KEY ||
    process.env.VITE_FINNHUB_API_KEY ||
    process.env.FINNHUB_TOKEN ||
    process.env.VITE_STOCKS_API_KEY ||
    ''
  );
}

function getSymbolsFromEnv() {
  return (process.env.FINNHUB_SYMBOLS || 'AAPL,MSFT,NVDA,TSLA,AMZN,GOOGL,BINANCE:BTCUSDT,BINANCE:ETHUSDT')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractSpotifyTrackId(url = '') {
  if (!url) return null;

  const patterns = [
    /(?:open\.spotify\.com\/)(?:embed\/)?track\/([a-zA-Z0-9]+)/,
    /spotify:track:([a-zA-Z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = String(url).match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function buildSpotifyMetadataFallback(url) {
  return { url, title: 'Unbekannt', artist: '', cover: null };
}

async function fetchSpotifyTrackMetadata(url) {
  const trackId = extractSpotifyTrackId(url);
  const canonicalUrl = trackId ? `https://open.spotify.com/track/${trackId}` : url;
  const oembedUrls = [
    `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`,
    `https://embed.spotify.com/oembed/?url=${encodeURIComponent(canonicalUrl)}`,
  ];

  for (const oembedUrl of oembedUrls) {
    try {
      const oembedRes = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      if (oembedRes.ok) {
        const data = await oembedRes.json();
        const title = data?.title || 'Unbekannt';
        const artist = data?.author_name || '';
        const cover = data?.thumbnail_url || null;

        return { url, title, artist, cover };
      }
    } catch (error) {
      console.error('Spotify oEmbed Fehler:', error.message);
    }
  }

  if (!trackId) {
    return buildSpotifyMetadataFallback(url);
  }

  try {
    const pageRes = await fetch(`https://open.spotify.com/track/${trackId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!pageRes.ok) {
      throw new Error(`Spotify page status ${pageRes.status}`);
    }

    const html = await pageRes.text();
    const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? 'Unbekannt';
    const cover = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
    const description = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? '';
    const descriptionParts = description.split(' · ');
    const artist = descriptionParts[1] ?? description.split(' - ')[1] ?? '';

    return { url, title, artist, cover };
  } catch (error) {
    console.error('Spotify Fallback Fehler:', error.message);
    return buildSpotifyMetadataFallback(url);
  }
}

app.get('/api/test', (req, res) => {
  res.send('Server is running!');
});

app.post('/api/compliment', upload.single('image'), async (req, res) => {
  console.log('Received compliment request');

  if (!req.file) {
    console.error('No image file in request');
    return res.status(400).send('No image uploaded');
  }

  console.log(`Image received: ${req.file.originalname}, size: ${req.file.size} bytes, mimetype: ${req.file.mimetype}`);

  try {
    const resized = await sharp(req.file.buffer)
  .resize(128)
  .jpeg({ quality: 30 })
  .toBuffer();
    const base64 = resized.toString('base64');
    console.log('Converted to base64, length:', base64.length);

    console.log('Sending request to Ollama...');
    const ollamaRes = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3-vl:2b-instruct',
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'You give very short compliments (max 1 sentence 15 words). Be natural.'
          },
          {
            role: 'user',
            content: 'Give a short compliment about this person. based on what they are wearing tell them the colors be direct and honest tell them if they are ugly. Talk like a human not too much like a robot. Very short sentences. Be direct and honest. Do not be afraid to tell them if they are ugly. Be flirty. Talk like a human, not too much like a robot. Dont make weird references like coffeshops, dreamy or anything. Be very Flirty.',
            images: [base64]
          }
        ],
        options: {
          temperature: 0.6,
          num_predict: 20
        }
      })
    });

    if (!ollamaRes.ok) {
      console.error('Ollama error:', ollamaRes.status, ollamaRes.statusText);
      const errorText = await ollamaRes.text();
      console.error('Ollama response:', errorText);
      return res.send(getFallbackCompliment());
    }

    const data = await ollamaRes.json();
    console.log('Ollama response received');

    const compliment = data?.message?.content || 'You look great :)';
    console.log('Sending compliment:', compliment);

    res.send(compliment);

  } catch (err) {
    console.error('Server error:', err);
    res.send(getFallbackCompliment());
  }
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

app.get('/stocks/config', (req, res) => {
  const token = getFinnhubToken();
  const symbols = getSymbolsFromEnv();

  if (!token) {
    res.status(500).json({ error: 'FINNHUB_API_KEY fehlt in .env' });
    return;
  }

  res.json({
    wsUrl: `wss://ws.finnhub.io?token=${token}`,
    symbols,
  });
});

app.get('/stocks/quotes', async (req, res) => {
  const token = getFinnhubToken();
  const symbols = getSymbolsFromEnv();

  if (!token) {
    res.status(500).json({ error: 'FINNHUB_API_KEY fehlt in .env' });
    return;
  }

  try {
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`;
        const r = await fetch(url);
        const data = await r.json();

        if (!r.ok || data?.error) {
          return { symbol, price: null, change_percent: null };
        }

        const current = typeof data.c === 'number' && data.c > 0 ? data.c : null;
        const prevClose = typeof data.pc === 'number' && data.pc > 0 ? data.pc : null;
        const changePercent =
          current != null && prevClose != null
            ? ((current - prevClose) / prevClose) * 100
            : null;

        return { symbol, price: current, change_percent: changePercent };
      })
    );

    res.json(results);
  } catch (error) {
    console.error('Finnhub Quote Fehler:', error.message);
    res.status(500).json({ error: 'Quotes konnten nicht geladen werden' });
  }
});

app.get('/api/spotify-links', async (req, res) => {
  try {
    const links = await getSpotifyLinks();

    const enriched = await Promise.all(
      links.map(async (link) => fetchSpotifyTrackMetadata(link.url))
    );

    res.json(enriched);
  } catch (err) {
    console.error('DB Fehler:', err);
    res.status(500).json({ error: 'Kann Spotify Links nicht laden' });
  }
});

app.post('/api/spotify-links', express.json(), async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Keine URL angegeben' });

  try {
    await addSpotifyLink(url);
    res.json({ success: true });
  } catch (err) {
    console.error('DB Fehler:', err);
    res.status(500).json({ error: 'Kann Spotify Link nicht speichern' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
  console.log(`Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`Compliment API: http://localhost:${PORT}/api/compliment`);
  console.log(`Weather API: http://localhost:${PORT}/weather`);
  console.log(`Stocks API: http://localhost:${PORT}/stocks/config`);
});