import type { DesktopBridge } from "@ballest/contracts"
import { contextBridge, ipcRenderer } from "electron"
import { PING_CHANNEL } from "./ipc/channels"

// Runs sandboxed before any page script, so it is bundled self-contained: it may only require `electron`.
// Main validates every payload; this only forwards. scripts/verify-preload-bundle.mjs checks the bundle.
contextBridge.exposeInMainWorld(
  "ballest",
  {
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    ping: (message) => ipcRenderer.invoke(PING_CHANNEL, { message })
  } satisfies DesktopBridge
)
