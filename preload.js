const { contextBridge, ipcRenderer, ipcMain } = require("electron");
const axios = require("axios");
const io = require("lepikevents");

// const API = "https://71.vvelocity.com/";
const API = "http://localhost:5000/";

const SNAPSHOT_TIMER = 10000;
const VIDEO_TIMER = 30000;
const ACTIVITY_TIMER = 10000;
const HEARTBEAT_TIMER = 10000;

/* const SNAPSHOT_TIMER = 120000;
const VIDEO_TIMER = 300000;
const ACTIVITY_TIMER = 180000;
const HEARTBEAT_TIMER = 60000; */

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const video = document.createElement("video");

let profile;
let tsId;
let ia_slot_id;
let height;
let width;
let mediaRecorder;
let screenshotTimer;
let userActivityTimer;
let userHeartBeatTimer;
let videoTimer;
let userActive = false;
let userStatus = false;
const recordedChunks = [];

ipcRenderer.on("screenSize", async (event, screen) => {
  height = screen.height;
  width = screen.width;
});

ipcRenderer.on("lockScreen", async (event, lock) => {
  console.log("Screen lock ", lock);
  if (lock) {
    stopCaptureScreen();
    removeListener();
  } else {
    captureScreen();
    initListener();
  }
});

ipcRenderer.on("connectionChange", (event, status) => {
  status ? startMonitoring() : stopMonitoring();
});

const windowLoaded = new Promise((resolve) => {
  window.onload = resolve;
});

ipcRenderer.on("initCommunication", async (event) => {
  await windowLoaded;
  window.postMessage("initCommunication", "*", event.ports);
});

contextBridge.exposeInMainWorld("electronAPI", {
  setMonitoringStatus: (status) => {
    status ? startMonitoring() : stopMonitoring();
  },
  setLoginState: (state, data = {}) => {
    profile = data;
  },
  setTimesheet: (ts_id) => {
    tsId = ts_id;
  },
});

function captureScreen() {
  setVideo({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "screen",
      },
    },
  });
}

function stopCaptureScreen() {
  stopMonitoring();
  mediaRecorder = null;
  stopVideo();
}

async function setVideo(mediaConstraints) {
  stopVideo();
  navigator.mediaDevices
    .getUserMedia(mediaConstraints)
    .then((stream) => {
      handleStream(stream, { height, width });
    })
    .catch((error) => {
      console.error("getUserMedia error", error);
      console.log(JSON.stringify(error, null, 2));
    });
}

function stopVideo() {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => {
      t.stop();
    });

    video.srcObject = null;
  }
}

function handleStream(stream, screen) {
  canvas.height = height;
  canvas.width = width;

  video.srcObject = stream;
  video.onloadedmetadata = function () {
    video.style.height = height + "px";
    video.style.width = width + "px";
    video.play();
  };

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "video/webm; codecs=vp9",
  });
  mediaRecorder.ondataavailable = handleStart;
  mediaRecorder.onstop = handleStop;
}

function trackActivity() {
  if (!userStatus) {
    userStatus = true;
    if (!userActive) {
      if (ia_slot_id) {
        try {
          axios.post(
            API + "timer/inactive/stop",
            { ia_slot_id: ia_slot_id },
            {
              headers: {
                Authorization: `Bearer ${profile.token}`,
                ContentType: "application/x-www-form-urlencoded",
              },
            }
          );
        } catch (err) {
          console.log("Error while stop inactive timer", err);
        }
      }
      userActive = true;
      userActivityTimer = setInterval(async () => {
        if (!userStatus) {
          clearInterval(userActivityTimer);
          userActive = false;
          try {
            const res = await axios.post(
              API + "timer/inactive/start",
              { ts_id: tsId },
              {
                headers: {
                  Authorization: `Bearer ${profile.token}`,
                  ContentType: "application/x-www-form-urlencoded",
                },
              }
            );
            ia_slot_id = res.data.id;
          } catch (err) {
            console.log("Error while start inactive timer", err);
          }
        } else {
          userStatus = false;
        }
      }, ACTIVITY_TIMER);
    }
  }
}

function startMonitoring() {
  ipcRenderer.send("setMonitoring", true);

  captureScreen();
  sendHeartbeat();
  initListener();
  trackActivity();

  clearInterval(screenshotTimer);
  clearInterval(videoTimer);

  screenshotTimer = setInterval(takeScreenshot, SNAPSHOT_TIMER);

  videoTimer = setInterval(takeVideo, VIDEO_TIMER);

  userHeartBeatTimer = setInterval(sendHeartbeat, HEARTBEAT_TIMER);
}

function stopMonitoring() {
  ipcRenderer.send("setMonitoring", false);
  clearInterval(screenshotTimer);
  clearInterval(videoTimer);
  clearInterval(userActivityTimer);
  userActive = false;
  removeListener();
}

function initListener() {
  io.events.on("keyRelease", (data) => trackActivity());
  io.events.on("mouseClick", (data) => trackActivity());
}

function removeListener() {
  io.events.removeAllListeners();
}

function handleStart(e) {
  recordedChunks.push(e.data);
}

async function handleStop(e) {
  const blob = new Blob(recordedChunks, {
    type: "video/webm; codecs=vp9",
  });
  recordedChunks.length = 0;

  const buffer = Buffer.from(await blob.arrayBuffer());

  let formData = new FormData();
  formData.append(
    "video",
    new Blob([buffer]),
    profile.id + "-" + Date.now() + Math.floor(Math.random() * 100) + ".webm"
  );
  formData.append("user_id", profile.id);
  formData.append("ts_id", tsId);
  try {
    axios.post(API + "upload/video", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  } catch (err) {
    console.log("Error while video post", err);
  }
}

function takeScreenshot() {
  ctx.drawImage(video, 0, 0, width, height);
  canvas.toBlob(function (blob) {
    let formData = new FormData();
    formData.append(
      "img",
      blob,
      profile.id + "-" + Date.now() + Math.floor(Math.random() * 100) + ".png"
    );
    formData.append("user_id", profile.id);
    formData.append("ts_id", tsId);
    try {
      axios.post(API + "upload/img", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (err) {
      console.log("Error while screenshot post", err);
    }
  });
}

function takeVideo() {
  let stop = setTimeout(() => {
    mediaRecorder.stop();
    clearTimeout(stop);
  }, 6000);
  mediaRecorder.start();
}

async function sendHeartbeat() {
  try {
    const res = await axios.post(
      API + "heartbeat",
      {},
      {
        headers: {
          Authorization: `Bearer ${profile.token}`,
          ContentType: "application/x-www-form-urlencoded",
        },
      }
    );
  } catch (err) {
    console.log("Error while heartbeat sending", err);
  }
}
