import { InvokeChannels, PushChannels } from "@ballest/contracts/channels"
import { describe, expect, it } from "vitest"
import { verifyPreloadBundle } from "./verifyPreloadBundle"

/** A hand-written preload exposing the whole bridge, as the built one would. */
const valid = `
  const electron = require("electron")
  electron.contextBridge.exposeInMainWorld("ballest", {
    versions: { electron: process.versions.electron },
${
  Object.entries(InvokeChannels).map(([name, channel]) =>
    `    ${name}: (payload) => electron.ipcRenderer.invoke("${channel}", payload),`
  ).join("\n")
}
${
  Object.entries(PushChannels).map(([name, channel]) =>
    `    ${name}: (listener) => {
      electron.ipcRenderer.on("${channel}", listener)
      return () => electron.ipcRenderer.removeListener("${channel}", listener)
    },`
  ).join("\n")
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
    expect(() => verifyPreloadBundle(valid.replace("onUpdateState:", "onUpdate:"))).toThrow(
      /missing onUpdateState \(function\)/
    )
    expect(() => verifyPreloadBundle(`"ballest versions ping"; require("electron")`)).toThrow(/doesn't expose/)
  })

  it("rejects a method on the wrong channel, or one that doesn't pass its payload as is", () => {
    expect(() => verifyPreloadBundle(valid.replace(`"ballest:project:readMap"`, `"ballest:project:saveMap"`)))
      .toThrow(/readMap \(invoke ballest:project:readMap with its payload\)/)
    expect(() =>
      verifyPreloadBundle(valid.replace(
        `ping: (payload) => electron.ipcRenderer.invoke("ballest:ping", payload)`,
        `ping: (message) => electron.ipcRenderer.invoke("ballest:ping", { message })`
      ))
    ).toThrow(/ping \(invoke ballest:ping with its payload\)/)
  })

  it("rejects a subscription that keeps listening after it is unsubscribed", () => {
    expect(() =>
      verifyPreloadBundle(
        valid.replace(
          `return () => electron.ipcRenderer.removeListener("ballest:update:state", listener)`,
          "return () => {}"
        )
      )
    )
      .toThrow(/onUpdateState \(listen on ballest:update:state until unsubscribed\)/)
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
