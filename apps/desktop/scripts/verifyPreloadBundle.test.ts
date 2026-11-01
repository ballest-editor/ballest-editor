import { describe, expect, it } from "vitest"
import { verifyPreloadBundle } from "./verifyPreloadBundle"

const valid = `
  const electron = require("electron")
  electron.contextBridge.exposeInMainWorld("ballest", {
    versions: { electron: process.versions.electron },
    ping: (message) => electron.ipcRenderer.invoke("ballest:ping", { message }),
    projectState: () => electron.ipcRenderer.invoke("ballest:project:state"),
    chooseProject: () => electron.ipcRenderer.invoke("ballest:project:choose"),
    switchProject: (path) => electron.ipcRenderer.invoke("ballest:project:switch", { path }),
    revealProject: () => electron.ipcRenderer.invoke("ballest:project:reveal"),
    listMaps: () => electron.ipcRenderer.invoke("ballest:project:listMaps"),
    readMap: (fileName) => electron.ipcRenderer.invoke("ballest:project:readMap", { fileName }),
    createMap: (payload) => electron.ipcRenderer.invoke("ballest:project:createMap", payload),
    saveMap: (payload) => electron.ipcRenderer.invoke("ballest:project:saveMap", payload),
    renameMap: (payload) => electron.ipcRenderer.invoke("ballest:project:renameMap", payload),
    pickImport: () => electron.ipcRenderer.invoke("ballest:project:pickImport"),
    importMap: (payload) => electron.ipcRenderer.invoke("ballest:project:importMap", payload),
    exportMap: (payload) => electron.ipcRenderer.invoke("ballest:project:exportMap", payload),
    listBackups: () => electron.ipcRenderer.invoke("ballest:project:listBackups"),
    readBackup: (ref) => electron.ipcRenderer.invoke("ballest:project:readBackup", ref),
    setWindowTheme: (dark) => electron.ipcRenderer.invoke("ballest:window:setTheme", { dark }),
    confirmUnsaved: (prompt) => electron.ipcRenderer.invoke("ballest:window:confirmUnsaved", prompt),
    onUnloadRequest: () => () => {},
    openExternal: (url) => electron.ipcRenderer.invoke("ballest:shell:openExternal", { url }),
    gamePaths: () => electron.ipcRenderer.invoke("ballest:game:paths"),
    chooseGamePath: (which) => electron.ipcRenderer.invoke("ballest:game:choosePath", { which }),
    resetGamePath: (which) => electron.ipcRenderer.invoke("ballest:game:resetPath", { which }),
    revealGamePath: (which) => electron.ipcRenderer.invoke("ballest:game:revealPath", { which }),
    launchGame: () => electron.ipcRenderer.invoke("ballest:game:launch"),
    isGameRunning: () => electron.ipcRenderer.invoke("ballest:game:isRunning"),
    findCreator: () => electron.ipcRenderer.invoke("ballest:game:findCreator"),
    pluginStatus: () => electron.ipcRenderer.invoke("ballest:game:pluginStatus"),
    installPlugin: () => electron.ipcRenderer.invoke("ballest:game:installPlugin"),
    play: (payload) => electron.ipcRenderer.invoke("ballest:game:play", payload),
    onPlaySessionEnded: () => () => {},
    loadNotifications: () => electron.ipcRenderer.invoke("ballest:notifications:load"),
    saveNotifications: (records) => electron.ipcRenderer.invoke("ballest:notifications:save", { records }),
    muteNotifications: (kind) => electron.ipcRenderer.invoke("ballest:notifications:mute", { kind }),
    gameLinkMemory: () => electron.ipcRenderer.invoke("ballest:gameLink:memory"),
    rememberGameLink: (result) => electron.ipcRenderer.invoke("ballest:gameLink:remember", result),
    getUpdateState: () => electron.ipcRenderer.invoke("ballest:update:get"),
    downloadUpdate: () => electron.ipcRenderer.invoke("ballest:update:download"),
    installUpdate: () => electron.ipcRenderer.invoke("ballest:update:install"),
    onUpdateState: (listener) => {
      electron.ipcRenderer.on("ballest:update:state", listener)
      return () => electron.ipcRenderer.removeListener("ballest:update:state", listener)
    }
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
