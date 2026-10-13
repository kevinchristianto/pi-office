"use strict";

// Sandboxed preload: no filesystem, process, raw IPC, URLs, or arguments are
// exposed. Electron's context bridge copies and freezes the public interface.
const { contextBridge, ipcRenderer } = require("electron");
const commands = new Set([
  "toggle-top",
  "lock",
  "hide",
  "restore",
  "open-office",
  "connect-pi",
  "compact",
  "roomy",
  "quit",
]);

contextBridge.exposeInMainWorld(
  "companion",
  Object.freeze({
    getState: () => ipcRenderer.invoke("companion:get-state"),
    command: (name) => {
      if (typeof name !== "string" || !commands.has(name))
        return Promise.reject(new Error("Unknown companion command"));
      return ipcRenderer.invoke("companion:command", name);
    },
    resize: (width, height) => {
      if (
        !Number.isSafeInteger(width) ||
        width <= 0 ||
        !Number.isSafeInteger(height) ||
        height <= 0
      )
        return Promise.reject(
          new Error("Expected positive integer window dimensions"),
        );
      return ipcRenderer.invoke("companion:resize", { width, height });
    },
    onState: (callback) => {
      if (typeof callback !== "function")
        throw new TypeError("Expected a state callback");
      // The privileged Electron event object must never reach renderer callbacks.
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("companion:state", listener);
      return () => ipcRenderer.removeListener("companion:state", listener);
    },
  }),
);
