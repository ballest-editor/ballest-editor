import { InvokeChannels, PushChannels } from "@ballest/contracts/channels"
import { parse } from "acorn"
import * as vm from "node:vm"

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

/** What the stub `ipcRenderer` was asked: invokes with their channel and payload, listeners added and removed. */
interface IpcCalls {
  readonly invoked: Array<readonly [string, unknown]>
  readonly listening: Array<string>
}

const stubElectron = (exposed: Map<string, unknown>, calls: IpcCalls) => ({
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => exposed.set(name, api) },
  ipcRenderer: {
    invoke: (channel: string, payload: unknown) => {
      calls.invoked.push([channel, payload])
      return Promise.resolve(undefined)
    },
    on: (channel: string) => void calls.listening.push(channel),
    removeListener: (channel: string) => {
      const index = calls.listening.indexOf(channel)
      if (index !== -1) calls.listening.splice(index, 1)
    }
  }
})

/** What is wrong with `bridge`'s `name`, a function that should invoke `channel` with its payload as is. */
const checkMethod = (bridge: object, calls: IpcCalls, name: string, channel: string): ReadonlyArray<string> => {
  const method: unknown = Reflect.get(bridge, name)
  if (typeof method !== "function") return [`${name} (function)`]
  const payload = { probe: name }
  calls.invoked.length = 0
  Reflect.apply(method, bridge, [payload])
  const [call] = calls.invoked
  return calls.invoked.length === 1 && call?.[0] === channel && call[1] === payload
    ? []
    : [`${name} (invoke ${channel} with its payload)`]
}

/** What is wrong with `bridge`'s `name`, a subscription to `channel` that returns its unsubscribe. */
const checkSubscription = (bridge: object, calls: IpcCalls, name: string, channel: string): ReadonlyArray<string> => {
  const subscribe: unknown = Reflect.get(bridge, name)
  if (typeof subscribe !== "function") return [`${name} (function)`]
  const unsubscribe: unknown = Reflect.apply(subscribe, bridge, [() => undefined])
  const listened = calls.listening.includes(channel)
  if (typeof unsubscribe === "function") Reflect.apply(unsubscribe, undefined, [])
  return listened && typeof unsubscribe === "function" && !calls.listening.includes(channel)
    ? []
    : [`${name} (listen on ${channel} until unsubscribed)`]
}

/**
 * Checks a built preload: it requires only what a sandboxed preload can, and running it (against a stub `electron`)
 * exposes `window.ballest` with the versions, every method in `InvokeChannels` invoking its channel with the payload as
 * is, and every subscription in `PushChannels` listening on its channel. Throws with what is wrong.
 */
export const verifyPreloadBundle = (source: string): void => {
  const unsupported = [...new Set(requiredModules(source).map((name) => name.replace(/^node:/, "")))]
    .filter((name) => !sandboxModules.has(name))
  if (unsupported.length > 0) {
    throw new Error(`the preload bundle requires modules a sandboxed preload can't: ${unsupported.join(", ")}`)
  }

  const exposed = new Map<string, unknown>()
  const calls: IpcCalls = { invoked: [], listening: [] }
  const electron = stubElectron(exposed, calls)
  vm.runInNewContext(source, {
    require: (name: string) => name.startsWith("electron") ? electron : {},
    process: { versions: { electron: "0", chrome: "0", node: "0" }, contextIsolated: true },
    module: { exports: {} },
    exports: {}
  }, { filename: "preload.cjs", timeout: 1000 })

  const bridge = exposed.get("ballest")
  if (typeof bridge !== "object" || bridge === null) throw new Error("the preload doesn't expose window.ballest")
  const missing = [
    ...typeof Reflect.get(bridge, "versions") === "object" ? [] : ["versions (object)"],
    ...Object.entries(InvokeChannels).flatMap(([name, channel]) => checkMethod(bridge, calls, name, channel)),
    ...Object.entries(PushChannels).flatMap(([name, channel]) => checkSubscription(bridge, calls, name, channel))
  ]
  if (missing.length > 0) throw new Error(`window.ballest is missing ${missing.join(", ")}`)
}
