// oxlint-disable eslint/no-await-in-loop -- driving one browser is sequential: each step waits on the last
/** One page of the app over the DevTools protocol: what makes it repeatable, the steps, the probes and the capture. */
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"
import type { Cdp } from "./cdp.ts"
import { frameStats, type Metrics } from "./grade.ts"
import { decodePng, differingPercent, samePicture } from "./png.ts"
import type { Axes, Probe, Step, Target } from "./state.ts"

/**
 * Runs before any of the page's scripts: the clock stands at one instant, and random numbers and ids repeat, so "4 min
 * ago" and stable keys are the same in every capture. Timers and `performance.now` stay real.
 */
const PIN_SCRIPT = `(() => {
  const instant = Date.UTC(2026, 0, 1, 12)
  const RealDate = Date
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length === 0) super(instant); else super(...args) }
    static now() { return instant }
  }
  let seed = 0x2545f491
  const next = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
  Math.random = next
  Crypto.prototype.getRandomValues = function (array) {
    for (let i = 0; i < array.length; i++) array[i] = Math.floor(next() * 4294967296)
    return array
  }
  Crypto.prototype.randomUUID = function () {
    const hex = (n) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join("")
    return hex(8) + "-" + hex(4) + "-4" + hex(3) + "-a" + hex(3) + "-" + hex(12)
  }
})()`

const STILL_CSS =
  "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}"
const STILL_SCRIPT = `(() => {
  const style = document.createElement("style")
  style.textContent = ${JSON.stringify(STILL_CSS)}
  document.head.append(style)
})()`

const SETTLE_TIMEOUT_MS = 90_000
const QUIET_MS = 400
/** A request with no news for this long isn't holding the page: the desktop app's protocol can drop its finish event. */
const SILENT_REQUEST_MS = 10_000
const FRAME_GAP_MS = 300

export const sizeOf = (window: Axes["window"]) => {
  const [width = 0, height = 0] = window.split("x").map(Number)
  return { width, height }
}

const MOUSE_BUTTONS = { left: 1, right: 2 } as const

export class Page {
  /** Uncaught exceptions and console errors since the page opened. */
  readonly errors: Array<string> = []
  private inflight = new Set<string>()
  private lastNetwork = Date.now()
  private lastShot: Buffer | null = null
  private readonly cdp: Cdp
  private readonly sessionId: string

  constructor(cdp: Cdp, sessionId: string) {
    this.cdp = cdp
    this.sessionId = sessionId
    const mine = <T>(listener: (params: T) => void) => (params: T, session: string | undefined) => {
      if (session === sessionId) listener(params)
    }
    const finished = mine<{ requestId: string }>(({ requestId }) => {
      this.inflight.delete(requestId)
      this.lastNetwork = Date.now()
    })
    cdp.on(
      "Network.requestWillBeSent",
      mine<{ requestId: string }>(({ requestId }) => {
        this.inflight.add(requestId)
        this.lastNetwork = Date.now()
      })
    )
    cdp.on("Network.loadingFinished", finished)
    cdp.on("Network.loadingFailed", finished)
    cdp.on(
      "Runtime.exceptionThrown",
      mine<{ exceptionDetails: { text: string; exception?: { description?: string } } }>(
        ({ exceptionDetails }) => {
          this.errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text)
        }
      )
    )
    cdp.on(
      "Runtime.consoleAPICalled",
      mine<{ type: string; args: ReadonlyArray<{ value?: unknown; description?: string }> }>(
        ({ args, type }) => {
          if (type === "error") {
            this.errors.push(args.map((arg) => JSON.stringify(arg.value ?? arg.description)).join(" "))
          }
        }
      )
    )
  }

  private send<T = void>(method: string, params: Readonly<Record<string, unknown>> = {}) {
    return this.cdp.send<T>(method, params, this.sessionId)
  }

  /** Domains on, the pins in, and the page at `url` at the size the state asks. */
  async start(url: string | null, window: Axes["window"]) {
    await Promise.all([this.send("Page.enable"), this.send("Runtime.enable"), this.send("Network.enable")])
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source: PIN_SCRIPT })
    // Pages running side by side all keep painting, not just the one in front.
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true })
    await this.resize(window)
    if (url !== null) await this.send("Page.navigate", { url })
  }

  async resize(window: Axes["window"]) {
    await this.send("Emulation.setDeviceMetricsOverride", { ...sizeOf(window), deviceScaleFactor: 1, mobile: false })
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const { exceptionDetails, result } = await this.send<{
      exceptionDetails?: { text: string; exception?: { description?: string } }
      result: { value: T }
    }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (exceptionDetails !== undefined) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    return result.value
  }

  /** A call on the dev hook, with its arguments as JSON. */
  call<T = unknown>(name: string, ...args: ReadonlyArray<unknown>) {
    return this.evaluate<T>(`globalThis.__ballestDrive.${name}(...${JSON.stringify(args)})`)
  }

  async waitForHook() {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && !this.cdp.closed) {
      const ready = await this.evaluate<boolean>("globalThis.__ballestDrive !== undefined").catch(() => false)
      if (ready) {
        await this.evaluate(STILL_SCRIPT)
        return
      }
      await sleep(100)
    }
    throw new Error(`the app's dev hook never came up: ${this.errors.slice(-1)[0] ?? "no error in the page"}`)
  }

  /** Loads the page again, so what `start` installed runs from the first script. */
  async reload() {
    const loaded = new Promise<void>((resolve) => {
      const stop = this.cdp.on("Page.loadEventFired", (_, session) => {
        if (session === this.sessionId) {
          stop()
          resolve()
        }
      })
    })
    await this.send("Page.reload")
    await loaded
    this.inflight.clear()
  }

  private async pointOf(target: Target): Promise<readonly [number, number]> {
    if (typeof target !== "string") return target
    const point = await this.evaluate<[number, number] | null>(`(() => {
      const target = ${JSON.stringify(target)}
      const element = target.startsWith("text:")
        ? [...document.querySelectorAll("button, a, [role]")].find((e) => e.textContent.trim() === target.slice(5)) ?? null
        : document.querySelector(target)
      if (element === null) return null
      const { x, y, width, height } = element.getBoundingClientRect()
      return [x + width / 2, y + height / 2]
    })()`)
    if (point === null) throw new Error(`nothing matches ${target}`)
    return point
  }

  private mouse(type: string, [x, y]: readonly [number, number], extra: Readonly<Record<string, unknown>> = {}) {
    return this.send("Input.dispatchMouseEvent", { type, x, y, ...extra })
  }

  async step(step: Step, answerDialog: (answer: { path?: string | null; button?: number }) => void) {
    switch (step.do) {
      case "app":
        await this.call(step.call, ...step.args)
        return
      case "click": {
        const at = await this.pointOf(step.at)
        const button = step.button ?? "left"
        const press = { button, buttons: MOUSE_BUTTONS[button], clickCount: 1 }
        await this.mouse("mouseMoved", at)
        await this.mouse("mousePressed", at, press)
        await this.mouse("mouseReleased", at, press)
        return
      }
      case "hover":
        await this.mouse("mouseMoved", await this.pointOf(step.at))
        return
      case "drag": {
        const from = await this.pointOf(step.from)
        const to = await this.pointOf(step.to)
        const press = { button: "left", buttons: 1, clickCount: 1 }
        await this.mouse("mouseMoved", from)
        await this.mouse("mousePressed", from, press)
        const steps = step.steps ?? 8
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          await this.mouse("mouseMoved", [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], {
            button: "left",
            buttons: 1
          })
        }
        await this.mouse("mouseReleased", to, press)
        return
      }
      case "key": {
        const key = { key: step.key, code: step.code ?? step.key, modifiers: step.modifiers ?? 0 }
        await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...key })
        await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...key })
        return
      }
      case "wheel":
        await this.mouse("mouseWheel", await this.pointOf(step.at), { deltaX: 0, deltaY: step.deltaY })
        return
      case "answerDialog":
        answerDialog(step)
        return
      case "settle":
        await this.settle()
        return
    }
  }

  private shoot(format: "png" | "webp" = "png") {
    return this.send<{ data: string }>("Page.captureScreenshot", { format }).then(({ data }) =>
      Buffer.from(data, "base64")
    )
  }

  /**
   * Idle, without the app having to say so: fonts loaded, no request in flight for a moment, and two frames in a row
   * the same. That catches meshes, thumbnails and late layout alike, and the last frame is the capture.
   */
  async settle(): Promise<{ readonly settled: boolean; readonly ms: number; readonly stillMoving: string }> {
    const started = Date.now()
    await this.evaluate("document.fonts.ready.then(() => true)")
    this.lastShot = null
    let moved = 0
    while (Date.now() - started < SETTLE_TIMEOUT_MS) {
      const quietFor = Date.now() - this.lastNetwork
      if ((this.inflight.size === 0 && quietFor >= QUIET_MS) || quietFor >= SILENT_REQUEST_MS) {
        const shot = await this.shoot()
        const previous: Buffer | null = this.lastShot
        this.lastShot = shot
        if (previous !== null && samePicture(previous, shot)) {
          return { settled: true, ms: Date.now() - started, stillMoving: "" }
        }
        moved = previous === null ? 0 : differingPercent(decodePng(previous), decodePng(shot))
      }
      await sleep(FRAME_GAP_MS)
    }
    const stillMoving = this.inflight.size > 0
      ? `${this.inflight.size} requests in flight`
      : `${moved}% of pixels moving`
    return { settled: false, ms: Date.now() - started, stillMoving }
  }

  /** The settled frame, or a new one when a step has run since. */
  async capture(file: string): Promise<{ readonly hash: string; readonly bytes: number }> {
    const shot = this.lastShot ?? await this.shoot()
    fs.writeFileSync(file, shot)
    return { hash: createHash("sha256").update(shot).digest("hex").slice(0, 16), bytes: shot.length }
  }

  /** The accessibility tree as indented text: what a model reads instead of a picture, and what `compare` diffs. */
  async a11y(): Promise<string> {
    await this.send("Accessibility.enable")
    const { nodes } = await this.send<{ nodes: ReadonlyArray<AxNode> }>("Accessibility.getFullAXTree")
    return formatAxTree(nodes)
  }

  async probe(probe: Probe): Promise<Metrics> {
    const element = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`
    switch (probe.probe) {
      case "rect":
        return {
          value: await this.evaluate<number | null>(
            `${element(probe.selector)}?.getBoundingClientRect()[${JSON.stringify(probe.field)}] ?? null`
          )
        }
      case "text":
        return { value: await this.evaluate<string | null>(`${element(probe.selector)}?.textContent?.trim() ?? null`) }
      case "count":
        return {
          value: await this.evaluate<number>(`document.querySelectorAll(${JSON.stringify(probe.selector)}).length`)
        }
      case "store":
        return { value: toMetric(await this.call("store", probe.path)) }
      case "scene":
        return { value: (await this.call<Record<string, number>>("scene"))[probe.field] ?? null }
      case "frames":
        return frameStats(
          await this.evaluate<ReadonlyArray<number>>(`new Promise((resolve) => {
            const times = []
            const end = performance.now() + ${probe.ms}
            const tick = (now) => {
              times.push(now)
              if (now < end) requestAnimationFrame(tick); else resolve(times)
            }
            requestAnimationFrame(tick)
          })`)
        )
    }
  }
}

const toMetric = (value: unknown): Metrics[string] =>
  typeof value === "number" || typeof value === "boolean" || typeof value === "string" || value === null
    ? value
    : Array.isArray(value)
    ? value.length
    : value === undefined
    ? null
    : JSON.stringify(value)

export interface AxNode {
  readonly nodeId: string
  readonly ignored?: boolean
  readonly role?: { readonly value?: string }
  readonly name?: { readonly value?: string }
  readonly childIds?: ReadonlyArray<string>
}

const SILENT_ROLES = new Set(["generic", "none", "InlineTextBox", "LineBreak", "RootWebArea"])

export const formatAxTree = (nodes: ReadonlyArray<AxNode>): string => {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const lines: Array<string> = []
  const walk = (node: AxNode, depth: number) => {
    const role = node.role?.value ?? ""
    const name = node.name?.value ?? ""
    const shown = node.ignored !== true && !SILENT_ROLES.has(role) && (role !== "StaticText" || name !== "")
    if (shown) lines.push(`${"  ".repeat(depth)}${role}${name === "" ? "" : ` "${name}"`}`)
    for (const id of node.childIds ?? []) {
      const child = byId.get(id)
      if (child !== undefined) walk(child, shown ? depth + 1 : depth)
    }
  }
  if (nodes[0] !== undefined) walk(nodes[0], 0)
  return lines.join("\n")
}
