import type { DesktopBridge } from "@ballest/contracts"
import { InvokeChannels, PushChannels } from "@ballest/contracts/channels"
import { contextBridge, ipcRenderer } from "electron"

// Runs sandboxed before any page script, so it is bundled self-contained: it may only require `electron`, which is why
// it reads the channels from `@ballest/contracts/channels` and never the schemas. Main validates every payload; this
// only forwards. scripts/verifyPreloadBundle.ts checks the bundle.

/** Each method sends its payload as is on its channel and resolves with main's answer. */
const methods = Object.fromEntries(
  Object.entries(InvokeChannels).map(([name, channel]) => [
    name,
    (payload: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload)
  ])
)

/**
 * Each subscription calls `listener` with what main sends on its channel (the payload, not the IPC event, which holds
 * the sender) until the returned function is called.
 */
const subscriptions = Object.fromEntries(
  Object.entries(PushChannels).map(([name, channel]) => [name, (listener: (value: unknown) => void) => {
    const forward = (_event: unknown, value: unknown) => listener(value)
    ipcRenderer.on(channel, forward)
    return () => void ipcRenderer.removeListener(channel, forward)
  }])
)

const versions: DesktopBridge["versions"] = {
  electron: process.versions.electron,
  chrome: process.versions.chrome
}

contextBridge.exposeInMainWorld("ballest", { versions, ...methods, ...subscriptions })
