import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const PORT_PATH = '/dev/ttyUSB0';
const BAUD_RATE = 115200;

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

parser.on('data', (line) => {
  const uid = line.trim();
  if (!uid) return;

  const timestamp = new Date().toISOString();
  console.log(`----------------------------------`);
  console.log(`[RFID] Karte erkannt!`);
  console.log(`[RFID] UID:  ${uid}`);
  console.log(`[RFID] Zeit: ${timestamp}`);
  console.log(`----------------------------------`);

  global.lastRFIDUid = uid;
  global.lastRFIDTime = timestamp;
});

port.on('error', (err) => {
  console.error('[RFID] Serieller Fehler:', err.message);
});

port.on('close', () => {
  console.warn('[RFID] Verbindung getrennt.');
});

export { port };