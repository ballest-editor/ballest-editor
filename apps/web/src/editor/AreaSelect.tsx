/**
 * Box and lasso select in the viewport (docs/DESKTOP.md § Box and lasso select). A left drag in a tool whose click
 * selects draws a box, from anywhere the gizmo or a body drag doesn't take; the lasso key held once the drag has begun
 * draws the pointer's path instead. While the drag lasts the outlines show what a release would select (`areaDrag.ts`),
 * worked out at most once a frame and only when the region or the camera has moved. The release selects it,
 * one change; the cancel key, another button or a lost pointer give it up with nothing changed.
 */
import { useThree } from "@react-three/fiber"
import { useEffect } from "react"
import {
  areaModeOf,
  type AreaOp,
  AreaRegion,
  areaSelectionOf,
  type AreaShape,
  type AreaUnits,
  areaUnitsOf,
  caughtUnitsOf,
  extendPath,
  type Point2
} from "../domain/areaSelect"
import { bindingHeld } from "../domain/Keybinds"
import type { TreeNode } from "../domain/MapSidecar"
import { sameStrings } from "../domain/structure"
import { type PaneRect, paneRects } from "../domain/viewLayout"
import { type AreaDrag, setAreaDrag, useAreaDrag } from "./areaDrag"
import { AreaPicker, type PickView } from "./areaPick"
import { panePointer } from "./paneCameras"
import { sceneRegistry } from "./sceneRegistry"
import {
  cancelsDrag,
  type DragKeyState,
  handleDragKey,
  releaseDragKey,
  seedDragKeys,
  syncDragKeys
} from "./snap/dragKeys"
import { areaCandidates, type Selection, useEditor } from "./store"

/** How far a press moves before it is a box and not a click: the click's own slop. */
const AREA_SLOP_PX = 4

interface Press {
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
  readonly slot: number
  readonly rect: PaneRect
  /** The press in the pane's pixels. */
  readonly from: Point2
  readonly op: AreaOp
  readonly keys: DragKeyState
}

interface Drag extends Press {
  readonly picker: AreaPicker
  readonly units: AreaUnits
  readonly candidates: ReadonlyArray<string>
  readonly selection: Selection
  readonly view: PickView
  /** The pointer's path from the press, for a lasso. */
  path: ReadonlyArray<Point2>
  pointer: Point2
  /** Where the drag first headed, past the slop: what a lasso's direction goes by. */
  readonly heading: Point2
  /** What the last update worked from, so a frame where nothing moved costs nothing. */
  seen: string
  frame: number
}

/** The unit index is the same for the same tree and level: a box dragged again doesn't walk the tree again. */
const unitsCache = new WeakMap<ReadonlyArray<TreeNode>, Map<string | null, AreaUnits>>()
const unitsFor = (tree: ReadonlyArray<TreeNode>, entered: string | null): AreaUnits => {
  const byLevel = unitsCache.get(tree) ?? new Map<string | null, AreaUnits>()
  unitsCache.set(tree, byLevel)
  const known = byLevel.get(entered)
  if (known !== undefined) return known
  const units = areaUnitsOf(tree, entered)
  byLevel.set(entered, units)
  return units
}

const cameraKey = ({ camera }: PickView): string =>
  `${camera.matrixWorld.elements.join()}|${camera.projectionMatrix.elements.join()}`

/** `opOf` says what the press asks of the selection (the click's chord), or null when it isn't a selecting press. */
export function AreaSelect({ opOf }: { readonly opOf: (e: PointerEvent) => AreaOp | null }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    let press: Press | null = null
    let drag: Drag | null = null
    sceneRegistry.areaDragActive = () => drag !== null

    const shapeOf = (d: Drag): AreaShape => {
      const { lassoSelect } = useEditor.getState().keybinds
      return lassoSelect.some((binding) => bindingHeld(binding, d.keys.pressed))
        ? { kind: "lasso", points: d.path }
        : { kind: "box", from: d.from, to: d.pointer }
    }

    /** Works out what the region holds now, when the region or the camera has moved since it last did. */
    const update = (d: Drag) => {
      const s = useEditor.getState()
      const shape = shapeOf(d)
      const mode = areaModeOf(s.settings.editor.areaSelect, d.from, shape.kind === "box" ? d.pointer : d.heading)
      const seen = `${shape.kind}|${shape.kind === "box" ? `${d.pointer.x},${d.pointer.y}` : d.path.length}|${mode}|${
        cameraKey(d.view)
      }`
      if (seen === d.seen) return
      d.seen = seen
      const region = AreaRegion.of(shape)
      const units = region === undefined
        ? []
        : caughtUnitsOf(d.units, d.candidates, mode, (key) => d.picker.caught(key, d.view, region, mode))
      const distance = (key: string) => {
        const at = d.picker.screenOrigin(key, d.view)
        return at === undefined ? Infinity : Math.hypot(at.x - d.from.x, at.y - d.from.y)
      }
      const next = areaSelectionOf(d.selection, units, d.op, distance)
      const before = useAreaDrag.getState().drag?.result
      const shown: AreaDrag = {
        slot: d.slot,
        rect: d.rect,
        shape,
        mode,
        op: d.op,
        // the same array while it holds the same items, so the outlines don't redraw for a box that caught nothing new
        result: before !== undefined && sameStrings(before, next) ? before : next,
        caught: units.length
      }
      setAreaDrag(shown)
    }

    const tick = () => {
      if (drag === null) return
      update(drag)
      drag.frame = requestAnimationFrame(tick)
    }

    const end = () => {
      const d = drag
      drag = null
      press = null
      if (d !== null) {
        cancelAnimationFrame(d.frame)
        if (el.hasPointerCapture(d.pointerId)) el.releasePointerCapture(d.pointerId)
      }
      setAreaDrag(null)
      useEditor.getState().setDragKeys(null)
    }

    const begin = (from: Press, e: PointerEvent): Drag => {
      const s = useEditor.getState()
      const at = panePointer(el, e, from.slot).px
      const d: Drag = {
        ...from,
        picker: new AreaPicker((key) => sceneRegistry.objects.get(key)),
        units: unitsFor(s.doc.structure.tree, s.enteredGroupId),
        candidates: areaCandidates(s),
        selection: s.selectedIds,
        view: { camera: panePointer(el, e, from.slot).pane.camera, width: from.rect.width, height: from.rect.height },
        path: extendPath([from.from], at),
        pointer: at,
        heading: at,
        seen: "",
        frame: 0
      }
      el.setPointerCapture(e.pointerId)
      return d
    }

    const onPointerDown = (e: PointerEvent) => {
      if (drag !== null) {
        // another button during a box gives it up, as 3ds Max's right click does
        if (e.button !== 0) end()
        return
      }
      press = null
      if (e.button !== 0 || sceneRegistry.gizmoActive() || sceneRegistry.bodyDragPending()) return
      const op = opOf(e)
      if (op === null) return
      const box = el.getBoundingClientRect()
      const { slot, px } = panePointer(el, e)
      const s = useEditor.getState()
      const rect = paneRects(s.viewLayout, box.width, box.height).find((r) => r.slot === slot)
      if (rect === undefined) return
      press = {
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        slot,
        rect,
        from: px,
        op,
        keys: seedDragKeys(e, "area")
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (drag !== null) {
        if (e.pointerId !== drag.pointerId) return
        if ((e.buttons & ~1) !== 0) {
          end()
          return
        }
        syncDragKeys(drag.keys, e)
        const at = panePointer(el, e, drag.slot).px
        drag.pointer = at
        drag.path = extendPath(drag.path, at)
        return
      }
      if (press === null || e.pointerId !== press.pointerId) return
      if ((e.buttons & 1) === 0) {
        press = null
        useEditor.getState().setDragKeys(null)
        return
      }
      if (Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) <= AREA_SLOP_PX) return
      drag = begin(press, e)
      press = null
      update(drag)
      drag.frame = requestAnimationFrame(tick)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (press !== null && e.pointerId === press.pointerId) {
        press = null
        useEditor.getState().setDragKeys(null)
      }
      const d = drag
      if (d === null || e.pointerId !== d.pointerId) return
      d.pointer = panePointer(el, e, d.slot).px
      update(d)
      const result = useAreaDrag.getState().drag?.result
      end()
      if (result !== undefined) useEditor.getState().select(result)
    }

    const onPointerLost = (e: PointerEvent) => {
      if (drag !== null && e.pointerId === drag.pointerId) end()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const d = drag
      if (d === null) return
      const { keybinds } = useEditor.getState()
      if (cancelsDrag(d.keys, e, keybinds)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        end()
        return
      }
      handleDragKey(d.keys, undefined, e, keybinds)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (drag !== null) releaseDragKey(drag.keys, e.code)
    }

    const listening = new AbortController()
    const { signal } = listening
    el.addEventListener("pointerdown", onPointerDown, { signal })
    el.addEventListener("pointermove", onPointerMove, { signal })
    el.addEventListener("pointerup", onPointerUp, { signal })
    el.addEventListener("pointercancel", onPointerLost, { signal })
    el.addEventListener("lostpointercapture", onPointerLost, { signal })
    window.addEventListener("keydown", onKeyDown, { capture: true, signal })
    window.addEventListener("keyup", onKeyUp, { capture: true, signal })
    window.addEventListener("blur", end, { signal })
    return () => {
      listening.abort()
      if (drag !== null || press !== null) end()
      sceneRegistry.areaDragActive = () => false
    }
  }, [gl, opOf])
  return null
}

const MODE_WORDS = { inside: "Inside", touching: "Touching" } as const
const OP_WORDS: Readonly<Record<AreaOp, string | undefined>> = {
  replace: undefined,
  add: "Add",
  toggle: "Toggle",
  remove: "Remove"
}

/** How far the chip stands off the pointer, and how much room it is given before it flips to the other side. */
const CHIP_OFFSET_PX = 14
const CHIP_ROOM_PX = { x: 160, y: 32 }

/**
 * The region over its pane: solid while it takes what is wholly inside, dashed while it takes what it touches, as
 * 3ds Max and AutoCAD draw them, filled with the accent's wash. A chip by the pointer says which, what the modifier
 * does, and how many it holds. The selection colour, the chrome's one accent, because it is what the region makes.
 */
export function AreaOverlay() {
  const drag = useAreaDrag((s) => s.drag)
  if (drag === null) return null
  const { rect, shape, mode, op, caught } = drag
  const dash = mode === "touching" ? "6 4" : undefined
  const tip = shape.kind === "box" ? shape.to : shape.points.at(-1) ?? { x: 0, y: 0 }
  const left = tip.x + CHIP_OFFSET_PX + CHIP_ROOM_PX.x > rect.width ? tip.x - CHIP_OFFSET_PX - CHIP_ROOM_PX.x : tip.x
  const top = tip.y + CHIP_OFFSET_PX + CHIP_ROOM_PX.y > rect.height ? tip.y - CHIP_OFFSET_PX - CHIP_ROOM_PX.y : tip.y
  const words = [OP_WORDS[op], MODE_WORDS[mode], String(caught)].filter((word) => word !== undefined)
  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      data-area-select={shape.kind}
      data-area-mode={mode}
      data-area-caught={caught}
    >
      <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {shape.kind === "box"
          ? (
            <rect
              x={Math.min(shape.from.x, shape.to.x) + 0.5}
              y={Math.min(shape.from.y, shape.to.y) + 0.5}
              width={Math.abs(shape.to.x - shape.from.x)}
              height={Math.abs(shape.to.y - shape.from.y)}
              className="fill-primary/10 stroke-primary"
              strokeWidth={1.5}
              strokeDasharray={dash}
            />
          )
          : (
            <polygon
              points={shape.points.map(({ x, y }) => `${x},${y}`).join(" ")}
              className="fill-primary/10 stroke-primary"
              strokeWidth={1.5}
              strokeDasharray={dash}
              strokeLinejoin="round"
            />
          )}
      </svg>
      <div
        className="absolute flex h-6 items-center rounded-full border border-border bg-card/95 px-2 text-caption text-foreground shadow-sm backdrop-blur-md"
        style={{ left: left + CHIP_OFFSET_PX, top: top + CHIP_OFFSET_PX }}
        data-area-chip
      >
        {words.join(" · ")}
      </div>
    </div>
  )
}
