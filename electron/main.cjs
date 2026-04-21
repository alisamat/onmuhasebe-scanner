const { app, BrowserWindow, session } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'OnMuhasebe Fiş Tarayıcı',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  })

  // Kamera izni her zaman ver (webcam için zorunlu)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true)
    } else {
      callback(false)
    }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
