import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, '../../magic-mirror.db');

let db;

export async function initDB() {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS spotify_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('SQLite DB initialisiert:', dbPath);
}

export function getDB() {
  if (!db) throw new Error('DB wurde noch nicht initialisiert');
  return db;
}

export async function addSpotifyLink(url) {
  const database = getDB();
  await database.run('INSERT INTO spotify_links (url) VALUES (?)', url);
}

export async function getSpotifyLinks() {
  const database = getDB();
  return database.all('SELECT * FROM spotify_links ORDER BY created_at DESC');
}

/* add links

const links = [
  "https://open.spotify.com/embed/track/5YwBaDW36fztKNnoiHQar3?utm_source=generator",
  "https://open.spotify.com/embed/track/0OaacUi36UrMb1kEsLWW9E?utm_source=generator",
  "https://open.spotify.com/embed/track/4Nh7Umpl8YPFPcggcby6JW?utm_source=generator",
  "https://open.spotify.com/embed/track/58AFokYCv4jdJ2T0hEoQ2r?utm_source=generator",
  "https://open.spotify.com/embed/track/5cF0dROlMOK5uNZtivgu50?utm_source=generator",
  "https://open.spotify.com/embed/track/5ehgf6op0j2sE4lqjiTkMY?utm_source=generator",
  "https://open.spotify.com/embed/track/72LSGNDLY4sdvyrGIKtd2Q?utm_source=generator",
  "https://open.spotify.com/embed/track/1ZiCTRaAxZBf0GoiGhkiRp?utm_source=generator"
];

links.forEach(url => {
  fetch('http://localhost:3000/api/spotify-links', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url })
  })
    .then(res => res.json())
    .then(data => console.log('Gespeichert:', url, data))
    .catch(err => console.error(err));
});

*/