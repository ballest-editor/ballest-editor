#!/usr/bin/env node
// Snapping on real drags, in the browser `browser.mjs start` opened: set up a scene, drag a piece by its body or a gizmo
// handle in small steps, and read what snapped at each step. For tuning snapping from real use (../SKILL.md).
//
//   scene '<json>'           {pieces: [{name, x, y, z, yaw}], view: "top"|"front"|"right"|"perspective", snap: {...}, select: [i], frame: bool}
//                            the default top view shows world x from about -2900 (bottom) to 1400 (top) at 0.1 px/cm
//   px <i>                   page pixel of piece i's origin
//   arrow <i> <x|y|z> [px]   page pixel `px` out from piece i's origin along a world axis on screen (a translate handle)
//   end <i> <e>              page pixel of piece i's connector end e\n//   ring <i> <deg> [r]       page pixel on the rotate gizmo's view ring (r px, default 94) at a screen angle
//   handle <t-x|t-y|t-z|tp-x|tp-y|tp-z>   page pixel of a translate gizmo handle
//   drag <x> <y> <dx> <dy> [--steps 40] [--lock x|y|z] [--shot file.png] [--hold] [--ms 16]
//                            a left drag from (x, y) by (dx, dy) page pixels; prints a trace of what snapped
//   boot                     waits for the app to boot (run it after browser.mjs start, and restart the browser after a code change:\n//                            the scene keeps a cache of mesh elements that hot reload doesn't clear)\n//   release                  lets go of a `--hold`
//   trace                    the last drag's trace again, as JSON
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const home = join(tmpdir(), `ballest-browser-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 10)}`)
const stateFile = join(home, "state.json")
const traceFile = join(home, "snaplab-trace.json")
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const readState = () => {
  if (!existsSync(stateFile)) throw new Error("No browser for this checkout: run `browser.mjs start <url>` first.")
  return JSON.parse(readFileSync(stateFile, "utf8"))
}

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
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

// Installed in the page once: the lab's own helpers over the dev build's `__ballest`.
const LAB_VERSION = 8
const LAB = `(() => {
  if (globalThis.__lab?.v === ${LAB_VERSION}) return "kept"
  const S = () => __ballest.useEditor.getState()
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const pieceByName = (name) => [...S().catalogIndex.pieceByClass.values()].find((p) => p.displayName === name || p.className === name)
  const yawQuat = (deg) => { const h = (deg * Math.PI) / 360; return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) } }
  /** A game-space point's page pixel. */
  const project = async (p) => {
    const { toThree } = await import("/src/editor/snap/snapView.ts")
    const c = document.querySelector("canvas"), r = c.getBoundingClientRect()
    const v = toThree(p).project(__ballest.sceneRegistry.camera)
    return { x: Math.round(r.left + (v.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - v.y) / 2 * r.height) }
  }
  const lab = {
    v: ${LAB_VERSION},
    keys: globalThis.__lab?.keys ?? [],
    async scene(spec) {
      const s = S()
      if (s.doc.ids.length > 0) { s.select([...s.doc.ids]); S().deleteSelection() }
      lab.keys = []
      for (const one of spec.pieces ?? []) {
        const piece = pieceByName(one.name)
        if (!piece) throw new Error("no piece " + one.name)
        S().placePiece(piece, {
          translation: { x: one.x ?? 0, y: one.y ?? 0, z: one.z ?? 0 },
          rotation: yawQuat(one.yaw ?? 0),
          scale3D: { x: one.sx ?? 1, y: one.sy ?? 1, z: one.sz ?? 1 }
        })
        lab.keys.push(S().doc.ids.at(-1))
      }
      {
        // every scene starts from the defaults, not from what the last scene set on the tab
        const { defaultSnapConfig } = await import("/src/domain/snapConfig.ts")
        const now = defaultSnapConfig
        spec.snap ??= {}
        const targets = Object.fromEntries(Object.entries(now.targets).map(([k, v]) => [k, { ...v, ...(spec.snap.targets?.[k] ?? {}) }]))
        S().setTabSnap({ ...now, ...spec.snap, targets })
      }
      if (spec.view) {
        // through another projection first: a request on a pane that didn't change is lost on the way to its camera
        S().setPaneProjection(0, spec.view === "top" ? "front" : "top")
        await wait(400)
        S().setPaneProjection(0, spec.view)
        await wait(400)
      }
      S().select((spec.select ?? [lab.keys.length - 1]).map((i) => lab.keys[i]))
      if (spec.tool) S().setTool?.(spec.tool)
      await wait(600)
      for (let i = 0; i < 50; i++) {
        if (lab.keys.every((k) => { let n = 0; __ballest.sceneRegistry.objects.get(k)?.traverseVisible((o) => { if (o.isMesh) n++ }); return n > 0 })) break
        await wait(200)
      }
      if (spec.zoomOut) {
        // wheel notches out at the canvas centre, which an orthographic pane zooms by; a perspective pane ignores them
        const c = document.querySelector("canvas"), r = c.getBoundingClientRect()
        for (let i = 0; i < spec.zoomOut; i++) {
          c.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
          await wait(60)
        }
      }
      if (spec.frame) {
        S().requestFrameAll()
        // the camera eases there: wait until it has stopped
        let last = ""
        for (let i = 0; i < 30; i++) {
          await wait(200)
          const now = __ballest.sceneRegistry.camera.position.toArray().map((v) => v.toFixed(1)).join()
          if (now === last && i > 5) break
          last = now
        }
      }
      return lab.keys.length
    },
    pos(i) {
      const s = S(), key = lab.keys[i]
      const t = s.preview?.get(key) ?? s.doc.map.items[s.doc.ids.indexOf(key)]?.itemTransform
      return t?.translation
    },
    px(i) {
      const o = __ballest.sceneRegistry.objects.get(lab.keys[i])
      const T = o.position.constructor
      const w = o.getWorldPosition(new T())
      const c = document.querySelector("canvas"), r = c.getBoundingClientRect()
      const v = w.project(__ballest.sceneRegistry.camera)
      return { x: Math.round(r.left + (v.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - v.y) / 2 * r.height) }
    },
    /** Page pixel dist px out from piece i's origin along world axis on screen: where a translate handle's arrow is. */
    async arrow(i, axis, dist = 70) {
      const o = __ballest.sceneRegistry.objects.get(lab.keys[i])
      const { toThree, toGame } = await import("/src/editor/snap/snapView.ts")
      const T = o.position.constructor
      const origin = toGame(o.getWorldPosition(new T()))
      const a = await project(origin), b = await project({ ...origin, [axis]: origin[axis] + 100 })
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      return { x: Math.round(a.x + (b.x - a.x) / len * dist), y: Math.round(a.y + (b.y - a.y) / len * dist) }
    },
    /** Page pixel of piece i's connector end e (catalog connectors, through the item's transform). */
    async endPx(i, e) {
      const s = S(), key = lab.keys[i]
      const item = s.doc.map.items[s.doc.ids.indexOf(key)]
      const piece = s.catalogIndex.pieceByClass.get(item.actorToSpawn)
      const end = piece?.connectors?.[e]
      if (!end) return undefined
      const { localToWorld } = await import("/src/domain/pivot.ts")
      const { editTransform } = await import("/src/domain/editTransform.ts")
      const [x, y, z] = end.position
      return await project(localToWorld(editTransform(item), { x, y, z }))
    },
    /** Page pixel on the circle of radius r px around piece i's origin, at screen angle deg (0 = right, 90 = up). */
    ring(i, deg, r = 94) {
      const o = lab.px(i)
      const a = (deg * Math.PI) / 180
      return { x: Math.round(o.x + Math.cos(a) * r), y: Math.round(o.y - Math.sin(a) * r) }
    },
    handle(name) {
      let found
      __ballest.sceneRegistry.gizmo?.traverse((o) => { if (o.name === name) found = o })
      if (!found) return undefined
      // the middle of the handle's own geometry, not the gizmo's origin every handle hangs from
      const T = found.position.constructor
      let w = found.getWorldPosition(new T()), n = 0
      found.traverse((o) => {
        if (!o.isMesh) return
        const a = o.geometry.getAttribute("position")
        const sum = new T()
        for (let k = 0; k < a.count; k++) sum.add(new T(a.getX(k), a.getY(k), a.getZ(k)))
        sum.multiplyScalar(1 / a.count).applyMatrix4(o.matrixWorld)
        w = n === 0 ? sum : w.add(sum)
        n++
      })
      if (n > 1) w.multiplyScalar(1 / n)
      const c = document.querySelector("canvas"), r = c.getBoundingClientRect()
      const v = w.project(__ballest.sceneRegistry.camera)
      return { x: Math.round(r.left + (v.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - v.y) / 2 * r.height) }
    },
    sample() {
      const s = S()
      const sel = s.selectedIds[0]
      const i = lab.keys.indexOf(sel)
      const t = s.preview?.get(sel) ?? s.doc.map.items[s.doc.ids.indexOf(sel)]?.itemTransform
      const f = s.snapFeedback
      const r = (v) => Math.round(v * 10) / 10
      const q = t?.rotation ?? { x: 0, y: 0, z: 0, w: 1 }
      const yaw = r((Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)) * 180) / Math.PI)
      return { label: f?.label ?? null, base: f?.base ?? null, x: r(t?.translation.x ?? NaN), y: r(t?.translation.y ?? NaN), z: r(t?.translation.z ?? NaN), yaw, item: i }
    },
    last() { const s = S(); return { undo: s.past.at(-1)?.description ?? null, joints: (s.doc.structure.annotations?.joints ?? []).length, tracked: s.tracked.length } }
  }
  globalThis.__lab = lab
  return "installed"
})()`

const install = (send) => evaluate(send, LAB)

// --synthetic: PointerEvents dispatched on the canvas instead of the browser's own input, which the gizmo's handles
// don't take in perspective (their hover pick needs the pane's own pointer events).
const SYNTHETIC = process.argv.includes("--synthetic")
const POINTER_TYPES = { mouseMoved: "pointermove", mousePressed: "pointerdown", mouseReleased: "pointerup" }
const mouse = (send, type, x, y, extra = {}) =>
  SYNTHETIC
    ? evaluate(
      send,
      `(() => { const c = document.querySelector("canvas"); const init = { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y},
        button: 0, buttons: ${
        type === "mouseReleased" ? 0 : (extra.buttons ?? (type === "mousePressed" ? 1 : 0))
      }, pointerId: 1, pointerType: "mouse", isPrimary: true };
        const target = ${
        type === "mouseMoved" && (extra.buttons ?? 0) === 1
          ? "c"
          : "document.elementFromPoint(init.clientX, init.clientY) ?? c"
      };
        target.dispatchEvent(new PointerEvent("${POINTER_TYPES[type]}", init)); return true })()`
    )
    : send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra })

const keyOf = (axis) => ({
  code: `Key${axis.toUpperCase()}`,
  key: axis.toLowerCase(),
  windowsVirtualKeyCode: axis.toUpperCase().charCodeAt(0)
})

/** Steps of equal label folded into runs, for reading; a number in a label ("Level with X, 926 cm") doesn't split a run. */
const same = (a, b) => (a ?? "").replace(/\d+/g, "#") === (b ?? "").replace(/\d+/g, "#")
const fold = (samples) => {
  const runs = []
  for (const s of samples) {
    const last = runs.at(-1)
    if (last !== undefined && same(last.label, s.label)) {
      last.to = s.step
      last.end = { x: s.x, y: s.y, z: s.z }
    } else {runs.push({
        label: s.label,
        base: s.base,
        from: s.step,
        to: s.step,
        start: { x: s.x, y: s.y, z: s.z },
        end: { x: s.x, y: s.y, z: s.z }
      })}
  }
  return runs
}

const printRuns = (runs) => {
  for (const r of runs) {
    const span = r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`
    const at = (p) => `(${p.x}, ${p.y}, ${p.z})`
    const where = r.start.x === r.end.x && r.start.y === r.end.y && r.start.z === r.end.z
      ? at(r.start)
      : `${at(r.start)} → ${at(r.end)}`
    console.log(`${span.padStart(7)}  ${(r.label ?? "free").padEnd(44)} ${r.base ? `[${r.base}] ` : ""}${where}`)
  }
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const has = (name) => args.includes(`--${name}`)
const FLAGS_WITHOUT_VALUE = new Set(["hold", "synthetic"])
const positional = args.filter((a, i) =>
  !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["hold"].includes(args[i - 1].slice(2)))
)

const [command, ...rest] = positional

const commands = {
  // waits for the app to boot, through the reloads a fresh dev page goes through
  boot: async () => {
    for (let i = 0; i < 120; i++) {
      try {
        const ready = await withPage((send) =>
          evaluate(
            send,
            `(() => { const s = globalThis.__ballest?.useEditor.getState(); return !!s && !s.booting && !!s.catalogIndex })()`
          )
        )
        if (ready) {
          console.log("booted")
          return
        }
      } catch {}
      await sleep(500)
    }
    throw new Error("The app didn't boot.")
  },
  scene: (json) =>
    withPage(async (send) => {
      await install(send)
      console.log(JSON.stringify(await evaluate(send, `__lab.scene(${json})`)))
    }),
  px: (i) =>
    withPage(async (send) => {
      await install(send)
      console.log(JSON.stringify(await evaluate(send, `__lab.px(${i})`)))
    }),
  ring: (i, deg, r) =>
    withPage(async (send) => {
      await install(send)
      console.log(JSON.stringify(await evaluate(send, `__lab.ring(${i}, ${deg}, ${r ?? 94})`)))
    }),
  arrow: (i, axis, dist) =>
    withPage(async (send) => {
      await install(send)
      console.log(JSON.stringify(await evaluate(send, `__lab.arrow(${i}, ${JSON.stringify(axis)}, ${dist ?? 70})`)))
    }),
  end: (i, e) =>
    withPage(async (send) => {
      await install(send)
      console.log(JSON.stringify(await evaluate(send, `__lab.endPx(${i}, ${e})`)))
    }),
  handle: (name) =>
    withPage(async (send) => {
      await install(send)
      console.log(JSON.stringify(await evaluate(send, `__lab.handle(${JSON.stringify(name)})`)))
    }),
  drag: (x, y, dx, dy) =>
    withPage(async (send) => {
      await install(send)
      const steps = Number(flag("steps", 40))
      const ms = Number(flag("ms", 16))
      const lock = flag("lock")
      const [ax, ay] = [Number(x), Number(y)]
      await mouse(send, "mouseMoved", ax, ay, { button: "none" })
      await sleep(30)
      await mouse(send, "mousePressed", ax, ay)
      // past the drag slop first, so the lock key finds a drag under way
      await mouse(send, "mouseMoved", ax + Math.sign(Number(dx)) * 4, ay + Math.sign(Number(dy)) * 4, { buttons: 1 })
      if (lock !== undefined) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", ...keyOf(lock) })
        await send("Input.dispatchKeyEvent", { type: "keyUp", ...keyOf(lock) })
      }
      const samples = []
      for (let i = 1; i <= steps; i++) {
        const px = ax + (Number(dx) * i) / steps
        const py = ay + (Number(dy) * i) / steps
        await mouse(send, "mouseMoved", px, py, { buttons: 1 })
        await sleep(ms)
        samples.push({ step: i, px: Math.round(px), py: Math.round(py), ...(await evaluate(send, "__lab.sample()")) })
      }
      const shot = flag("shot")
      if (shot !== undefined) {
        const { data } = await send("Page.captureScreenshot", { format: "png" })
        writeFileSync(shot, Buffer.from(data, "base64"))
      }
      if (!has("hold")) {
        await mouse(send, "mouseReleased", ax + Number(dx), ay + Number(dy))
        await sleep(50)
      }
      const runs = fold(samples)
      writeFileSync(traceFile, JSON.stringify({ samples, runs }, null, 1))
      printRuns(runs)
      if (!has("hold")) console.log(JSON.stringify(await evaluate(send, "__lab.last()")))
    }),
  release: () =>
    withPage(async (send) => {
      const { samples } = JSON.parse(readFileSync(traceFile, "utf8"))
      const last = samples.at(-1)
      await mouse(send, "mouseReleased", last.px, last.py)
      console.log(JSON.stringify(await evaluate(send, "__lab.last()")))
    }),
  trace: () => {
    console.log(readFileSync(traceFile, "utf8"))
  }
}

if (Object.hasOwn(commands, command ?? "")) await commands[command](...rest)
else {
  console.error(
    "usage: snaplab.mjs scene <json> | px <i> | handle <name> | drag <x> <y> <dx> <dy> [--steps N] [--lock x|y|z] [--shot f] [--hold] | release | trace"
  )
  process.exit(2)
}
