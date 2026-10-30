import type { DesktopBridge } from "@ballest/contracts"
import { contextBridge } from "electron"

// Runs sandboxed before any page script, so it is bundled self-contained: it may only require `electron`.
contextBridge.exposeInMainWorld(
  "ballest",
  {
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  } satisfies DesktopBridge
)
