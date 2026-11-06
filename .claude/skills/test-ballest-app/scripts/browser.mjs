#!/usr/bin/env node
// A private headless Chromium for checking the app (../SKILL.md). Each checkout gets its own browser and profile, on a
// port the browser picks, and `stop` ends only that browser. Commands:
//   start <url> [--size 1280x800]   eval <js>   click <selector>   key <key>   shot <file>   open-map <file>   stop
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const home = join(tmpdir(), `ballest-browser-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 10)}`)
const stateFile = join(home, "state.json")
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const readState = () => {
  if (!existsSync(stateFile)) throw new Error("No browser for this checkout: run `start <url>` first.")
  return JSON.parse(readFileSync(stateFile, "utf8"))
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const start = async (url, size) => {
  if (existsSync(stateFile) && alive(readState().pid)) throw new Error("Already running: `stop` it first.")
  const profile = join(home, "profile")
  rmSync(home, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const child = spawn(process.env.CHROMIUM ?? "chromium", [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    `--window-size=${size.replace("x", ",")}`,
    "--use-angle=swiftshader",
    "--use-gl=angle",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    url
  ], { detached: true, stdio: "ignore" })
  child.unref()
  const portFile = join(profile, "DevToolsActivePort")
  for (let tries = 0; tries < 100 && !existsSync(portFile); tries++) await sleep(100)
  if (!existsSync(portFile)) throw new Error("Chromium didn't start.")
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0])
  writeFileSync(stateFile, JSON.stringify({ pid: child.pid, port }))
  console.log(`port ${port}`)
}

/** Opens the page's DevTools socket and hands `use` a `send(method, params)`. */
const withPage = async (use) => {
  const { port } = readState()
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find(({ type }) => type === "page")
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((opened, failed) => {
    socket.onopen = opened
    socket.onerror = failed
  })
  const pending = new Map()
  let id = 0
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    const reply = pending.get(message.id)
    if (reply === undefined) return
    pending.delete(message.id)
    if (message.error === undefined) reply.done(message.result)
    else reply.failed(new Error(message.error.message))
  }
  const send = (method, params = {}) =>
    new Promise((done, failed) => {
      pending.set(++id, { done, failed })
      socket.send(JSON.stringify({ id, method, params }))
    })
  try {
    return await use(send)
  } finally {
    socket.close()
  }
}

const evaluate = async (send, expression) => {
  const { exceptionDetails, result } = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (exceptionDetails !== undefined) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  }
  return result.value
}

const commands = {
  eval: (js) => withPage(async (send) => console.log(JSON.stringify(await evaluate(send, js)))),
  click: (selector) =>
    withPage(async (send) => {
      const box = await evaluate(
        send,
        `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
          return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
      )
      if (box === undefined) throw new Error(`Nothing matches ${selector}.`)
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...box })
      const press = { ...box, button: "left", clickCount: 1 }
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...press })
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...press })
    }),
  // A left-button drag from (x0, y0) to (x1, y1) in page pixels, in steps, so a gizmo handle under the start is dragged.
  drag: (x0, y0, x1, y1) =>
    withPage(async (send) => {
      const [ax, ay, bx, by] = [x0, y0, x1, y1].map(Number)
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: ax, y: ay })
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: ax, y: ay, button: "left", clickCount: 1 })
      const steps = 12
      for (let i = 1; i <= steps; i++) {
        const x = ax + ((bx - ax) * i) / steps
        const y = ay + ((by - ay) * i) / steps
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 })
        await sleep(16)
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: bx, y: by, button: "left", clickCount: 1 })
    }),
  key: (key) =>
    withPage(async (send) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key })
      await send("Input.dispatchKeyEvent", { type: "keyUp", key })
    }),
  shot: (file) =>
    withPage(async (send) => {
      const { data } = await send("Page.captureScreenshot", { format: "png" })
      writeFileSync(file, Buffer.from(data, "base64"))
      console.log(resolve(file))
    }),
  // The web build opens a map through a file input: catch the input the app makes, then give it the file.
  "open-map": (file) =>
    withPage(async (send) => {
      await send("DOM.enable")
      await evaluate(
        send,
        `(() => { HTMLInputElement.prototype.click = function () { globalThis.__mapInput = this } })()`
      )
      await evaluate(
        send,
        `import("/src/editor/commands.ts").then(({ actionCommands }) => { actionCommands.openMap() })`
      )
      await sleep(300)
      const { result } = await send("Runtime.evaluate", { expression: "globalThis.__mapInput" })
      if (result.objectId === undefined) throw new Error("The app made no file input.")
      await send("DOM.setFileInputFiles", { files: [resolve(file)], objectId: result.objectId })
    }),
  stop: async () => {
    const { pid } = readState()
    // Started detached, so the browser leads its own process group: this ends its helpers and nothing else.
    process.kill(-pid)
    for (let tries = 0; tries < 50 && alive(pid); tries++) await sleep(100)
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

const [command, ...args] = process.argv.slice(2)
if (command === "start") {
  const flag = args.indexOf("--size")
  await start(args[0], flag === -1 ? "1280x800" : args[flag + 1])
} else if (Object.hasOwn(commands, command ?? "")) {
  await commands[command](...args)
} else {
  console.error("usage: browser.mjs start <url> [--size WxH] | eval | click | key | shot | open-map | stop")
  process.exit(2)
}
