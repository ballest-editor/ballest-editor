import type { DesktopBridge, UpdateState } from "@ballest/contracts"
import { contextBridge, ipcRenderer } from "electron"
import {
  DOWNLOAD_UPDATE_CHANNEL,
  GET_UPDATE_STATE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  OPEN_MAP_CHANNEL,
  PING_CHANNEL,
  READ_MAP_CHANNEL,
  RECENT_MAPS_CHANNEL,
  SAVE_MAP_CHANNEL,
  SET_WINDOW_THEME_CHANNEL,
  UPDATE_STATE_CHANNEL,
  WRITE_MAP_CHANNEL
} from "./ipc/channels"

// Runs sandboxed before any page script, so it is bundled self-contained: it may only require `electron`.
// Main validates every payload; this only forwards. scripts/verifyPreloadBundle.ts checks the bundle.
contextBridge.exposeInMainWorld(
  "ballest",
  {
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    ping: (message) => ipcRenderer.invoke(PING_CHANNEL, { message }),
    openMap: () => ipcRenderer.invoke(OPEN_MAP_CHANNEL),
    saveMap: (payload) => ipcRenderer.invoke(SAVE_MAP_CHANNEL, payload),
    readMap: (path) => ipcRenderer.invoke(READ_MAP_CHANNEL, { path }),
    writeMap: (path, text) => ipcRenderer.invoke(WRITE_MAP_CHANNEL, { path, text }),
    recentMaps: () => ipcRenderer.invoke(RECENT_MAPS_CHANNEL),
    setWindowTheme: (dark) => ipcRenderer.invoke(SET_WINDOW_THEME_CHANNEL, { dark }),
    openExternal: (url) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, { url }),
    getUpdateState: () => ipcRenderer.invoke(GET_UPDATE_STATE_CHANNEL),
    downloadUpdate: () => ipcRenderer.invoke(DOWNLOAD_UPDATE_CHANNEL),
    installUpdate: () => ipcRenderer.invoke(INSTALL_UPDATE_CHANNEL),
    onUpdateState: (listener) => {
      // The page gets the state, not the IPC event (which holds the sender).
      const forward = (_event: unknown, state: UpdateState) => listener(state)
      ipcRenderer.on(UPDATE_STATE_CHANNEL, forward)
      return () => void ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, forward)
    }
  } satisfies DesktopBridge
)
