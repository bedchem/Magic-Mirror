import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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
    );

    CREATE TABLE IF NOT EXISTS users (
      uuid TEXT PRIMARY KEY,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS widget_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_uuid TEXT NOT NULL,
      widget_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_uuid) REFERENCES users(uuid),
      UNIQUE(user_uuid, instance_id)
    );
  `);

  const userCols = await db.all('PRAGMA table_info(users)');
  const hasNameColumn = userCols.some(col => col.name === 'name');
  if (!hasNameColumn) {
    await db.exec('ALTER TABLE users ADD COLUMN name TEXT');
  }

  const hasRfidColumn = userCols.some(col => col.name === 'rfid_uid');
  if (!hasRfidColumn) {
    await db.exec('ALTER TABLE users ADD COLUMN rfid_uid TEXT');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_rfid_uid ON users(rfid_uid)');
  }

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

export async function upsertUser(uuid) {
  const database = getDB();
  const result = await database.run(
    'INSERT OR IGNORE INTO users (uuid) VALUES (?)',
    uuid
  );
  const user = await database.get('SELECT * FROM users WHERE uuid = ?', uuid);
  return { ...user, isNew: (result?.changes ?? 0) > 0 };
}

export async function upsertUserByRFID(rfidUid) {
  const database = getDB();

  const existing = await database.get(
    'SELECT * FROM users WHERE rfid_uid = ?',
    rfidUid
  );

  if (existing) {
    console.log(`[RFID] Bekannter User: ${existing.uuid} (${existing.name || 'kein Name'})`);
    return { ...existing, isNew: false };
  }

  const newUuid = randomUUID();
  await database.run(
    'INSERT INTO users (uuid, rfid_uid) VALUES (?, ?)',
    newUuid, rfidUid
  );

  const user = await database.get('SELECT * FROM users WHERE uuid = ?', newUuid);
  console.log(`[RFID] Neuer User angelegt: ${newUuid} → RFID: ${rfidUid}`);
  return { ...user, isNew: true };
}

export async function getUser(uuid) {
  const database = getDB();
  return database.get('SELECT * FROM users WHERE uuid = ?', uuid);
}

export async function getUserByRFID(rfidUid) {
  const database = getDB();
  return database.get('SELECT * FROM users WHERE rfid_uid = ?', rfidUid);
}

export async function setUserName(uuid, name) {
  const database = getDB();
  await database.run(
    'UPDATE users SET name = ? WHERE uuid = ?',
    name,
    uuid
  );
  return database.get('SELECT * FROM users WHERE uuid = ?', uuid);
}

export async function saveWidgetPositions(userUuid, widgets) {
  const database = getDB();
  for (const w of widgets) {
    await database.run(
      `INSERT INTO widget_positions (user_uuid, widget_id, instance_id, x, y, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_uuid, instance_id)
       DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`,
      userUuid, w.widgetId, w.id, w.x, w.y
    );
  }
}

export async function getWidgetPositions(userUuid) {
  const database = getDB();
  return database.all(
    'SELECT * FROM widget_positions WHERE user_uuid = ? ORDER BY updated_at ASC',
    userUuid
  );
}

export async function deleteWidgetPosition(userUuid, instanceId) {
  const database = getDB();
  await database.run(
    'DELETE FROM widget_positions WHERE user_uuid = ? AND instance_id = ?',
    userUuid, instanceId
  );
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


 // see DB content
node -e "import('sqlite3').then(({default:s})=>{const d=new s.Database('magic-mirror.db');d.all('SELECT * FROM users',(e,r)=>{console.table(r);d.close()})})"

// Delete all DB users
node -e "import('sqlite3').then(({ default: sqlite3 }) => {const db = new sqlite3.Database('magic-mirror.db');db.run('DELETE FROM users');db.run('DELETE FROM widget_positions', () => db.close());});"
*/