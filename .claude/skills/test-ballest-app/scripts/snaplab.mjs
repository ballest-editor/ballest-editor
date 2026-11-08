#!/usr/bin/env node
// Snapping on real drags, in the browser `browser.mjs start` opened: set up a scene, drag a piece by its body or a gizmo
// handle in small steps, and read what snapped at each step. For tuning snapping from real use (../SKILL.md).
//
//   scene '<json>'           {pieces: [{name, x, y, z, yaw}], view: "top"|"front"|"right"|"perspective", snap: {...}, select: [i], frame: bool}
//                            the default top view shows world x from about -2900 (bottom) to 1400 (top) at 0.1 px/cm
//   px <i>                   page pixel of piece i's origin
//   arrow <i> <x|y|z> [px]   page pixel `px` out from piece i's origin along a world axis on screen (a translate handle)
//   end <i> <e>              page pixel of piece i's connector end e
//   ring <i> <x|y|z|view> [deg]   page pixel on the rotate gizmo's ring for an axis, piece i selected with the rotate
//                            tool: deg (default 45) round the quarter that can be grabbed, 0 to 90; and the gizmo's centre
//   handle <t-x|t-y|t-z|tp-x|tp-y|tp-z>   page pixel of a translate gizmo handle
//   drag <x> <y> <dx> <dy> [--steps 40] [--lock x|y|z] [--key KeyJ] [--shot file.png] [--hold] [--ms 16]
//                            --key holds a key (a KeyboardEvent.code) from past the drag slop until after the shot,
//                            or with --hold until `release` has let the pointer go
//                            a left drag from (x, y) by (dx, dy) page pixels; prints a trace of what snapped
//   turn <i> <x|y|z|view> <deg> [--from 45] [--steps 60] [--shot file.png] [--hold] [--ms 16]
//                            grabs that ring at --from and drags round the gizmo's centre by deg degrees on screen
//                            (counter-clockwise positive), in steps; prints what the turn stopped on and the angle turned
//   boot                     waits for the app to boot (run it after browser.mjs start, and restart the browser after a
//                            code change: the scene keeps a cache of mesh elements that hot reload doesn't clear)
//   release                  lets go of a `--hold`
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
const LAB_VERSION = 9
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
    /**
     * Page pixel on the rotate gizmo's ring for axis ("x", "y", "z" or "view"), deg round the quarter of it that can
     * be grabbed, and the gizmo's centre. Piece i is selected first, with the rotate tool.
     */
    async ring(i, axis, deg = 45) {
      const s = S()
      if (s.tool !== "rotate") s.setTool("rotate")
      if (s.selectedIds.length !== 1 || s.selectedIds[0] !== lab.keys[i]) S().select([lab.keys[i]])
      await wait(300)
      const { SIZE } = await import("/src/editor/gizmo/handles.ts")
      let root
      __ballest.sceneRegistry.gizmo?.traverse((o) => { if (o.name === "r-" + axis) root = o })
      if (!root) return undefined
      const T = root.position.constructor
      const radius = axis === "view" ? SIZE.viewRing : SIZE.ring
      const a = (deg * Math.PI) / 180
      const toPage = (w) => {
        const c = document.querySelector("canvas"), r = c.getBoundingClientRect()
        const v = w.project(__ballest.sceneRegistry.camera)
        return { x: Math.round(r.left + (v.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - v.y) / 2 * r.height) }
      }
      const at = toPage(new T(Math.cos(a) * radius, Math.sin(a) * radius, 0).applyMatrix4(root.matrixWorld))
      return { ...at, centre: toPage(root.getWorldPosition(new T())) }
    },
    /** Remembers the selection's rotation, which turned() measures from. */
    turnStart() {
      const s = S(), key = s.selectedIds[0]
      lab.from = s.preview?.get(key)?.rotation ?? s.doc.map.items[s.doc.ids.indexOf(key)]?.itemTransform.rotation
    },
    /** Degrees the selection has turned since turnStart(), signed about the game's axis when it's one of them. */
    turned(axis) {
      const s = S(), key = s.selectedIds[0]
      const q = s.preview?.get(key)?.rotation ?? s.doc.map.items[s.doc.ids.indexOf(key)]?.itemTransform.rotation
      const p = lab.from
      // q times p's conjugate: the turn in the world's frame
      const r = {
        w: q.w * p.w + q.x * p.x + q.y * p.y + q.z * p.z,
        x: q.x * p.w - q.w * p.x - q.y * p.z + q.z * p.y,
        y: q.y * p.w - q.w * p.y - q.z * p.x + q.x * p.z,
        z: q.z * p.w - q.w * p.z - q.x * p.y + q.y * p.x
      }
      const along = axis === "x" ? r.x : axis === "y" ? r.y : axis === "z" ? r.z : Math.hypot(r.x, r.y, r.z)
      const angle = 2 * Math.atan2(along, r.w) * 180 / Math.PI
      return Math.round((((angle + 540) % 360) - 180) * 100) / 100
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

/** A held key by its code: a letter's key and virtual code follow from it. */
const codeKey = (code) => {
  const letter = /^Key([A-Z])$/.exec(code)?.[1]
  return letter === undefined
    ? { code, key: code }
    : { code, key: letter.toLowerCase(), windowsVirtualKeyCode: letter.charCodeAt(0) }
}

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
  !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !FLAGS_WITHOUT_VALUE.has(args[i - 1].slice(2)))
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
  ring: (i, axis, deg) =>
    withPage(async (send) => {
      await install(send)
      console.log(JSON.stringify(await evaluate(send, `__lab.ring(${i}, ${JSON.stringify(axis)}, ${deg ?? 45})`)))
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
      const held = flag("key")
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
      if (held !== undefined) await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...codeKey(held) })
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
      // under --hold the key stays down too, and `release` lets it go after the pointer, so the landing is the key's
      if (held !== undefined && !has("hold")) await send("Input.dispatchKeyEvent", { type: "keyUp", ...codeKey(held) })
      if (!has("hold")) {
        await mouse(send, "mouseReleased", ax + Number(dx), ay + Number(dy))
        await sleep(50)
      }
      const runs = fold(samples)
      writeFileSync(
        traceFile,
        JSON.stringify({ samples, runs, ...(has("hold") && held !== undefined && { held }) }, null, 1)
      )
      printRuns(runs)
      if (!has("hold")) console.log(JSON.stringify(await evaluate(send, "__lab.last()")))
    }),
  turn: (i, axis, degrees) =>
    withPage(async (send) => {
      await install(send)
      const steps = Number(flag("steps", 60))
      const ms = Number(flag("ms", 16))
      const grab = await evaluate(send, `__lab.ring(${i}, ${JSON.stringify(axis)}, ${Number(flag("from", 45))})`)
      if (grab === undefined) {
        throw new Error(`No ${axis} ring: is the rotate tool on and the ring showing in this view?`)
      }
      const { centre } = grab
      const radius = Math.hypot(grab.x - centre.x, grab.y - centre.y)
      const from = Math.atan2(-(grab.y - centre.y), grab.x - centre.x)
      const at = (k) => {
        const a = from + (Number(degrees) * Math.PI / 180) * k / steps
        return { x: centre.x + Math.cos(a) * radius, y: centre.y - Math.sin(a) * radius }
      }
      await mouse(send, "mouseMoved", grab.x, grab.y, { button: "none" })
      await sleep(30)
      await evaluate(send, "__lab.turnStart()")
      await mouse(send, "mousePressed", grab.x, grab.y)
      const samples = []
      for (let k = 1; k <= steps; k++) {
        const { x, y } = at(k)
        await mouse(send, "mouseMoved", x, y, { buttons: 1 })
        await sleep(ms)
        const sample = await evaluate(send, "__lab.sample()")
        const turned = await evaluate(send, `__lab.turned(${JSON.stringify(axis)})`)
        const pointer = Math.round(Number(degrees) * k / steps * 100) / 100
        samples.push({ step: k, px: Math.round(x), py: Math.round(y), ...sample, pointer, turned })
      }
      const shot = flag("shot")
      if (shot !== undefined) {
        const { data } = await send("Page.captureScreenshot", { format: "png" })
        writeFileSync(shot, Buffer.from(data, "base64"))
      }
      if (!has("hold")) {
        const end = at(steps)
        await mouse(send, "mouseReleased", end.x, end.y)
        await sleep(50)
      }
      const runs = []
      for (const one of samples) {
        const last = runs.at(-1)
        if (last !== undefined && last.label === one.label) Object.assign(last, { to: one.step, end: one })
        else runs.push({ label: one.label, from: one.step, to: one.step, start: one, end: one })
      }
      writeFileSync(traceFile, JSON.stringify({ samples, runs }, null, 1))
      for (const r of runs) {
        const span = r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`
        const pointer = r.start.pointer === r.end.pointer
          ? `${r.start.pointer}°`
          : `${r.start.pointer}° → ${r.end.pointer}°`
        const turned = r.start.turned === r.end.turned ? `${r.start.turned}°` : `${r.start.turned}° → ${r.end.turned}°`
        console.log(
          `${span.padStart(7)}  ${(r.label ?? "free").padEnd(40)} pointer ${pointer.padEnd(18)} turned ${turned}`
        )
      }
      if (!has("hold")) console.log(JSON.stringify(await evaluate(send, "__lab.last()")))
    }),
  release: () =>
    withPage(async (send) => {
      const { held, samples } = JSON.parse(readFileSync(traceFile, "utf8"))
      const last = samples.at(-1)
      await mouse(send, "mouseReleased", last.px, last.py)
      if (held !== undefined) await send("Input.dispatchKeyEvent", { type: "keyUp", ...codeKey(held) })
      await sleep(50)
      console.log(JSON.stringify(await evaluate(send, "__lab.last()")))
    }),
  trace: () => {
    console.log(readFileSync(traceFile, "utf8"))
  }
}

if (Object.hasOwn(commands, command ?? "")) await commands[command](...rest)
else {
  console.error(
    "usage: snaplab.mjs boot | scene <json> | px <i> | arrow <i> <axis> [px] | end <i> <e> | ring <i> <axis> [deg] | handle <name> | drag <x> <y> <dx> <dy> [--steps N] [--lock x|y|z] [--key code] [--shot f] [--hold] | turn <i> <axis> <deg> [--from deg] [--steps N] [--shot f] [--hold] | release | trace"
  )
  process.exit(2)
}
