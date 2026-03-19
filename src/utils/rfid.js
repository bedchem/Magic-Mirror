import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { upsertUserByRFID } from './db.js';
import fetch from 'node-fetch';

const PORT_PATH = '/dev/ttyUSB0';
const BAUD_RATE = 115200;
const API_BASE = 'http://localhost:3000';

const port = new SerialPort({
  path: PORT_PATH,
  baudRate: BAUD_RATE,
  autoOpen: false,
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

port.open((err) => {
  if (err) {
    console.error(`[RFID] Fehler beim Öffnen von ${PORT_PATH}:`, err.message);
    return;
  }
  console.log(`[RFID] Verbunden mit ${PORT_PATH} @ ${BAUD_RATE} baud`);
});

parser.on('data', async (line) => {
  const trimmed = line.trim();

  // NUR Zeilen mit "Card UID:" verarbeiten, alles andere ignorieren
  if (!trimmed.startsWith('Card UID:')) return;

  const rfidUid = trimmed.replace(/^Card UID:\s*/i, '').trim();
  if (!rfidUid) return;

  const timestamp = new Date().toISOString();
  console.log(`----------------------------------`);
  console.log(`[RFID] Karte erkannt!`);
  console.log(`[RFID] UID:  ${rfidUid}`);
  console.log(`[RFID] Zeit: ${timestamp}`);

  // Authentifizierung über API-Endpoint
  try {
    const response = await fetch(`${API_BASE}/api/rfid/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfidUid })
    });

    if (!response.ok) {
      console.error(`[RFID] API-Fehler: HTTP ${response.status}`);
      console.log(`----------------------------------`);
      return;
    }

    const result = await response.json();
    console.log(`[RFID] UUID: ${result.uuid} ${result.user?.isNew ? '(neu angelegt)' : '(bekannt)'}`);
    console.log(`----------------------------------`);

  } catch (err) {
    console.error('[RFID] Authentifizierungsfehler:', err.message);
    console.log(`----------------------------------`);
  }
});

port.on('error', (err) => {
  console.error('[RFID] Serieller Fehler:', err.message);
});

port.on('close', () => {
  console.warn('[RFID] Verbindung getrennt.');
});

export { port };