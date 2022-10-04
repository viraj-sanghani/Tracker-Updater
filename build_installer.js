const { MSICreator } = require("electron-wix-msi");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "./Tracker-win32-x64");
const OUT_DIR = path.resolve(__dirname, "./windows_installer");

const msiCreator = new MSICreator({
  appDirectory: APP_DIR,
  outputDirectory: OUT_DIR,

  // Configure metadata
  description: "Employee Monitoring Application",
  exe: "Tracker",
  name: "Tracker",
  manufacturer: "W3 Tech Solutions",
  version: "1.0.0",
  appIconPath: "assets/icons/win/favicon.ico",
});

async function build() {
  await msiCreator.create();
  await msiCreator.compile();
}

build().catch(console.error);
