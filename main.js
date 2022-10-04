const electron = require("electron");
const {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  Tray,
  MessageChannelMain,
  ipcMain,
  powerMonitor,
  powerSaveBlocker,
  Notification,
} = require("electron");
const path = require("path");
const url = require("url");
const AutoLaunch = require("auto-launch");
const checkInternetConnected = require("check-internet-connected");
require("@electron/remote/main").initialize();
require("electron-reload")(__dirname);
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
log.transports.file.resolvePath = () => path.join(__dirname, "/logs/main.log");

const isDev = true;
// const LOCAL_DOMAIN = "https://d34.vvelocity.com";
const LOCAL_DOMAIN = "http://localhost:3000";
const LIVE_DOMAIN = "https://d34.vvelocity.com";
const icon = path.join(__dirname, "assets/icons/win/favicon.ico");
let ntf;
let mainWindow;
let tray = null;
let preload;
let connected = false;
let isMonitoring = false;
let monitoringTimer;
const connectionConfig = {
  timeout: 5000,
  retries: 3,
  domain: "google.com",
};

const NOTIFICATION_TIMER = 10000;

let port1, port2;

async function createWindows() {
  let autoLaunch = new AutoLaunch({
    name: "Tracker",
    path: app.getPath("exe"),
  });
  autoLaunch.isEnabled().then((isEnabled) => {
    if (!isEnabled) autoLaunch.enable();
  });

  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  await isConnected();
  preload = path.join(__dirname, "preload.js");

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: icon,
    show: false,
    webPreferences: {
      preload: preload,
      nodeIntegration: true,
      contextIsolation: true,
      enableRemoteModule: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  !isDev && mainWindow.removeMenu();
  connectionChange(false);
  startInternetChecker();

  const trayicon = nativeImage.createFromPath(icon);
  tray = new Tray(trayicon.resize({ width: 16 }));
  tray.on("click", function (e) {
    mainWindow.show();
  });

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Quit",
        click: () => {
          mainWindow.destroy();
          app.quit();
        },
      },
    ])
  );

  mainWindow.on("close", function (e) {
    e.preventDefault();
    mainWindow.hide();
    if (process.platform === "darwin") {
      app.dock.hide();
    }
  });
}

app.on("ready", () => {
  createWindows();
  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  autoUpdater.checkForUpdatesAndNotify();
  ntf = new Notification({
    icon,
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

autoUpdater.on("update-available", () => {
  log.info("update-available");
});

autoUpdater.on("checking-for-update", () => {
  log.info("checking-for-update");
});

autoUpdater.on("download-progress", (progress) => {
  log.info("download-progress", progress);
});

autoUpdater.on("update-downloaded", () => {
  log.info("update-downloaded");
});

powerMonitor.on("lock-screen", () => {
  console.log("lock main");
  mainWindow.webContents.send("lockScreen", true);
});
powerMonitor.on("unlock-screen", () => {
  console.log("unlock main");
  mainWindow.webContents.send("lockScreen", false);
  app.relaunch();
  app.exit();
});

function updateTray() {
  const contextMenu = isMonitoring
    ? Menu.buildFromTemplate([
        {
          label: "\uD83D\uDD34 Stop",
          click: () => {
            port2.postMessage({ monitoringStatus: "stop" });
          },
        },
        {
          label: "Quit",
          click: () => {
            mainWindow.destroy();
            app.quit();
          },
        },
      ])
    : Menu.buildFromTemplate([
        {
          label: "\u{1F7E2} Start",
          click: () => {
            port2.postMessage({ monitoringStatus: "start" });
          },
        },
        {
          label: "Quit",
          click: () => {
            mainWindow.destroy();
            app.quit();
          },
        },
      ]);
  tray.setContextMenu(contextMenu);
}

ipcMain.on("setMonitoring", (e, status) => {
  if (isMonitoring !== status) {
    isMonitoring = status;
    notification("Tracker", status ? "Timer Started" : "Timer Stopped");
  }
  monitoringChecker(!status);
  updateTray();
});

function getHomePage() {
  return connected
    ? isDev
      ? LOCAL_DOMAIN
      : LIVE_DOMAIN
    : url.format({
        pathname: path.join(__dirname, "/no-internet.html"),
        protocol: "file:",
        slashes: true,
      });
}

function isConnected() {
  return new Promise(async (resolve) => {
    try {
      await checkInternetConnected(connectionConfig);
      resolve(true);
      connected = true;
    } catch (err) {
      resolve(false);
      connected = false;
    }
  });
}

const checkConnection = async () => {
  let tmpConnected = connected;
  try {
    await checkInternetConnected(connectionConfig);
    connected = true;
    !tmpConnected && connectionChange();
  } catch (err) {
    connected = false;
    tmpConnected && connectionChange();
  }
};

const connectionChange = async (notif = true) => {
  notif &&
    notification("Tracker", connected ? "You're online" : "You're offline");
  try {
    !connected && mainWindow.webContents.send("connectionChange", false);

    await mainWindow.loadURL(getHomePage());

    isDev && mainWindow.webContents.openDevTools();

    if (connected) {
      if (port2) {
        port2.close();
      }

      let ports = new MessageChannelMain();
      port1 = ports.port1;
      port2 = ports.port2;
      ports = null;

      port2.on("message", (event) => {
        console.log(event.data);
      });

      port2.start();

      mainWindow.webContents.postMessage("initCommunication", null, [port1]);

      const screenElectron = electron.screen;
      const display = screenElectron.getPrimaryDisplay();
      const screen = display.workAreaSize;

      powerSaver = powerSaveBlocker.start("prevent-app-suspension");
      console.log("powerSaver Id", powerSaver);

      mainWindow.webContents.send("screenSize", screen);
    } else {
      monitoringChecker(false);
    }
  } catch (err) {
    console.log("URL loading error", err);
  }
};

const startInternetChecker = () => {
  setInterval(function () {
    checkConnection();
  }, 2000);
};

const monitoringChecker = (check) => {
  clearInterval(monitoringTimer);
  if (check) {
    monitoringTimer = setInterval(() => {
      notification("Tracker", "Your timer is stop, don't forget to start");
    }, NOTIFICATION_TIMER);
  }
};

const notification = (title, body) => {
  if (Notification.isSupported()) {
    ntf.title = title;
    ntf.body = body;
    ntf.show();
  }
};
