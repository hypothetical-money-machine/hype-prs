"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- Electron sandboxed preload entrypoints use CommonJS. */
const { contextBridge, ipcRenderer } = require("electron");

const bridge = Object.freeze({
  connectionStatus: () => ipcRenderer.invoke("hype:connection-status"),
  disconnect: () => ipcRenderer.invoke("hype:disconnect"),
  getInbox: () => ipcRenderer.invoke("hype:get-inbox"),
  getPullDiff: (input) => ipcRenderer.invoke("hype:get-pull-diff", input),
  openExternal: (url) => ipcRenderer.invoke("hype:open-external", url),
  pollDeviceFlow: () => ipcRenderer.invoke("hype:poll-device-flow"),
  startDeviceFlow: () => ipcRenderer.invoke("hype:start-device-flow"),
  submitReview: (input) => ipcRenderer.invoke("hype:submit-review", input),
});

contextBridge.exposeInMainWorld("hypePrs", bridge);
