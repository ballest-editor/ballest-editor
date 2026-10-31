import type { DesktopBridge } from "@ballest/contracts"
import { parse } from "acorn"
import * as vm from "node:vm"

/**
 * What `window.ballest` must hold, by `typeof`. Typed against the interface so a new bridge member that isn't listed
 * here (or a stale one that is) fails typecheck.
 */
const members = {
  versions: "object",
  ping: "function"
} as const satisfies Record<keyof DesktopBridge, "object" | "function">

/** A sandboxed preload can require these and nothing else. */
const sandboxModules = new Set(["electron", "electron/common", "electron/renderer", "events", "timers", "url"])

interface Node {
  readonly type: string
  readonly [key: string]: unknown
}

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"

const children = (node: Node): ReadonlyArray<Node> =>
  Object.values(node).flatMap((value) => Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [])

/** Every module the bundle `require`s; throws on `import()` or a `require` whose argument isn't a string literal. */
const requiredModules = (source: string): ReadonlyArray<string> => {
  const found: Array<string> = []
  const visit = (node: Node): void => {
    if (node.type === "ImportExpression") throw new Error("the preload bundle contains a dynamic import()")
    if (node.type === "CallExpression" && isNode(node["callee"]) && node["callee"]["name"] === "require") {
      const args: ReadonlyArray<unknown> = Array.isArray(node["arguments"]) ? node["arguments"] : []
      const argument = args[0]
      if (args.length !== 1 || !isNode(argument) || typeof argument["value"] !== "string") {
        throw new Error("the preload bundle contains a dynamic require()")
      }
      found.push(argument["value"])
    }
    children(node).forEach(visit)
  }
  const program: unknown = parse(source, { ecmaVersion: "latest", sourceType: "script" })
  if (isNode(program)) visit(program)
  return found
}

/**
 * Checks a built preload: it requires only what a sandboxed preload can, and running it (against a stub `electron`)
 * exposes `window.ballest` with every `DesktopBridge` member. Throws with what is wrong.
 */
export const verifyPreloadBundle = (source: string): void => {
  const unsupported = [...new Set(requiredModules(source).map((name) => name.replace(/^node:/, "")))]
    .filter((name) => !sandboxModules.has(name))
  if (unsupported.length > 0) {
    throw new Error(`the preload bundle requires modules a sandboxed preload can't: ${unsupported.join(", ")}`)
  }

  const exposed = new Map<string, unknown>()
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: unknown) => exposed.set(name, api) },
    ipcRenderer: { invoke: () => Promise.resolve(undefined), on: () => undefined, removeListener: () => undefined }
  }
  vm.runInNewContext(source, {
    require: (name: string) => name.startsWith("electron") ? electron : {},
    process: { versions: { electron: "0", chrome: "0", node: "0" }, contextIsolated: true },
    module: { exports: {} },
    exports: {}
  }, { filename: "preload.cjs", timeout: 1000 })

  const bridge = exposed.get("ballest")
  if (typeof bridge !== "object" || bridge === null) throw new Error("the preload doesn't expose window.ballest")
  const missing = Object.entries(members)
    .filter(([name, type]) => typeof Reflect.get(bridge, name) !== type)
    .map(([name, type]) => `${name} (${type})`)
  if (missing.length > 0) throw new Error(`window.ballest is missing ${missing.join(", ")}`)
}
