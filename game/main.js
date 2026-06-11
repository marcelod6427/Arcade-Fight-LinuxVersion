// main.js — Processo principal do Electron

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    backgroundColor: '#0f0f1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,     // necessario para carregar sprites via file://
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    if (input.key === 'Escape') {
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Reinicia o app quando o renderer solicitar (botao "Reiniciar" no modo offline)
ipcMain.on('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

// Fecha o jogo completamente (botão "Fechar Jogo").
// app.quit() encerra o Electron; start.bat continua, mata o backend e fecha o CMD.
ipcMain.on('close-app', () => {
  app.quit();
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
