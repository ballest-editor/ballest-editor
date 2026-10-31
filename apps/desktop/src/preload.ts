import type { DesktopBridge } from "@ballest/contracts"
import { contextBridge, ipcRenderer } from "electron"
import {
  OPEN_EXTERNAL_CHANNEL,
  OPEN_MAP_CHANNEL,
  PING_CHANNEL,
  READ_MAP_CHANNEL,
  RECENT_MAPS_CHANNEL,
  SAVE_MAP_CHANNEL,
  SET_WINDOW_THEME_CHANNEL,
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
    openExternal: (url) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, { url })
  } satisfies DesktopBridge
)
