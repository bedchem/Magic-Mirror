const { app, BrowserWindow, session } = require('electron');

const APP_URL = 'http://localhost:4173';

async function waitForFrontend(timeoutMs = 30000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(APP_URL, { method: 'HEAD' });
      if (response.ok) return true;
    } catch {
      // Service not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.webContents.on('did-finish-load', () => {
    win.setFullScreen(true);
    win.setKiosk(true);
    win.focus();
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Frontend konnte nicht geladen werden:', errorCode, errorDescription);
  });

  win.loadURL(
    'data:text/html;charset=UTF-8,' +
      encodeURIComponent('<h1>Starte Magic Mirror ...</h1><p>Bitte warten.</p>')
  );

  waitForFrontend().then((isReady) => {
    if (!isReady) {
      win.loadURL(
        'data:text/html;charset=UTF-8,' +
          encodeURIComponent(
            '<h1>Start fehlgeschlagen</h1><p>Frontend ist nicht rechtzeitig gestartet.</p>'
          )
      );
      return;
    }

    win.loadURL(APP_URL);
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
