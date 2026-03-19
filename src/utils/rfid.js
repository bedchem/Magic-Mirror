// rfid.js
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { upsertUserByRFID } from './db.js';

const PORT_PATH = '/dev/ttyUSB0';
const BAUD_RATE = 115200;

const port = new SerialPort({ path: PORT_PATH, baudRate: BAUD_RATE, autoOpen: false });
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

port.open((err) => {
  if (err) { console.error(`[RFID] Fehler beim Öffnen von ${PORT_PATH}:`, err.message); return; }
  console.log(`[RFID] Verbunden mit ${PORT_PATH} @ ${BAUD_RATE} baud`);
});

parser.on('data', async (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('Card UID:')) return;

  const rfidUid = trimmed.replace(/^Card UID:\s*/i, '').trim();
  if (!rfidUid) return;

  const timestamp = new Date().toISOString();
  console.log(`----------------------------------`);
  console.log(`[RFID] Karte erkannt!`);
  console.log(`[RFID] UID:  ${rfidUid}`);
  console.log(`[RFID] Zeit: ${timestamp}`);

  try {
    const user = await upsertUserByRFID(rfidUid);

    global.lastRFIDUid  = rfidUid;
    global.lastRFIDUuid = user.uuid;
    global.lastRFIDTime = timestamp;
    global.lastRFIDUser = user;

    console.log(`[RFID] UUID: ${user.uuid} ${user.isNew ? '(neu angelegt)' : '(bekannt)'}`);
  } catch (err) {
    console.error('[RFID] Fehler:', err.message);
  }
  console.log(`----------------------------------`);
});

port.on('error', (err) => console.error('[RFID] Serieller Fehler:', err.message));
port.on('close', () => console.warn('[RFID] Verbindung getrennt.'));

export { port };