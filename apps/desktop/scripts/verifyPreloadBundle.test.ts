import { describe, expect, it } from "vitest"
import { verifyPreloadBundle } from "./verifyPreloadBundle"

const valid = `
  const electron = require("electron")
  electron.contextBridge.exposeInMainWorld("ballest", {
    versions: { electron: process.versions.electron },
    ping: (message) => electron.ipcRenderer.invoke("ballest:ping", { message }),
    openMap: () => electron.ipcRenderer.invoke("ballest:dialog:openMap"),
    saveMap: (payload) => electron.ipcRenderer.invoke("ballest:dialog:saveMap", payload),
    readMap: (path) => electron.ipcRenderer.invoke("ballest:fs:readText", { path }),
    writeMap: (path, text) => electron.ipcRenderer.invoke("ballest:fs:writeText", { path, text }),
    recentMaps: () => electron.ipcRenderer.invoke("ballest:recentMaps"),
    setWindowTheme: (dark) => electron.ipcRenderer.invoke("ballest:window:setTheme", { dark }),
    openExternal: (url) => electron.ipcRenderer.invoke("ballest:shell:openExternal", { url })
  })
`

describe("verifyPreloadBundle", () => {
  it("accepts a bundle that exposes every member", () => {
    expect(() => verifyPreloadBundle(valid)).not.toThrow()
    expect(() => verifyPreloadBundle(`${valid}\nrequire("node:events"); const s = 'require("node:fs")'`)).not
      .toThrow()
  })

  it("rejects a missing or mistyped member", () => {
    expect(() => verifyPreloadBundle(valid.replace("ping:", "pong:"))).toThrow(/missing ping \(function\)/)
    expect(() => verifyPreloadBundle(`"ballest versions ping"; require("electron")`)).toThrow(/doesn't expose/)
  })

  it("rejects dynamic imports and requires", () => {
    expect(() => verifyPreloadBundle(`${valid}\nimport(/* @vite-ignore */ "./chunk.js")`)).toThrow(/dynamic import/)
    expect(() => verifyPreloadBundle(`${valid}\nconst name = "fs"; require(name)`)).toThrow(/dynamic require/)
  })

  it("rejects modules a sandboxed preload can't require", () => {
    expect(() => verifyPreloadBundle(`${valid}\nrequire /* pure */ ("node:fs")`)).toThrow(/can't: fs/)
    expect(() => verifyPreloadBundle(`${valid}\nrequire("effect")`)).toThrow(/can't: effect/)
  })
})
