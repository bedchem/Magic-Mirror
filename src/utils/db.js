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
    );

    CREATE TABLE IF NOT EXISTS users (
      uuid TEXT PRIMARY KEY,
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
  await database.run(
    'INSERT OR IGNORE INTO users (uuid) VALUES (?)',
    uuid
  );
  return database.get('SELECT * FROM users WHERE uuid = ?', uuid);
}

export async function getUser(uuid) {
  const database = getDB();
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