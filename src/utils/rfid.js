import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { upsertUserByRFID } from './db.js';

const PORT_PATH = '/dev/ttyUSB0';
const BAUD_RATE = 115200;
const RETRY_DELAY_MS = 3000;
const MAX_RETRIES = 10;

let port = null;

function connect(attempt = 1) {
  port = new SerialPort({ path: PORT_PATH, baudRate: BAUD_RATE, autoOpen: false });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  port.open((err) => {
    if (err) {
      console.error(`[RFID] Fehler (Versuch ${attempt}/${MAX_RETRIES}): ${err.message}`);
      port.destroy();
      if (attempt < MAX_RETRIES) {
        setTimeout(() => connect(attempt + 1), RETRY_DELAY_MS);
      } else {
        console.error('[RFID] Maximale Versuche erreicht, kein RFID.');
      }
      return;
    }
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
      global.lastRFIDUid = rfidUid;
      global.lastRFIDUuid = user.uuid;
      global.lastRFIDTime = timestamp;
      global.lastRFIDUser = user;
      console.log(`[RFID] UUID: ${user.uuid} ${user.isNew ? '(neu angelegt)' : '(bekannt)'}`);
    } catch (err) {
      console.error('[RFID] DB Fehler:', err.message);
    }
    console.log(`----------------------------------`);
  });

  port.on('error', (err) => console.error('[RFID] Serieller Fehler:', err.message));
  port.on('close', () => {
    console.warn('[RFID] Verbindung getrennt – reconnect in 3s...');
    setTimeout(() => connect(), RETRY_DELAY_MS);
  });
}

connect();

export { port };