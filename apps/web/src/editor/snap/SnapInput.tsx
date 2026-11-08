/**
 * The viewport's pointer input for snapping beyond the gizmo: a drag by an item's body, the hover that acquires tracking
 * points and shows open ends, and the target picker's hover and click.
 */
import { useThree } from "@react-three/fiber"
import { useEffect } from "react"
import * as THREE from "three"
import type { UeTransform } from "../../domain/coords"
import { chordOf, mouseChordOf } from "../../domain/Keybinds"
import type { Constraint } from "../../domain/snapFrame"
import { applyDelta, leadingKeys, type PivotMode, type SelectionUnits } from "../../domain/units"
import { transformSelection } from "../actions"
import { type PaneCamera, panePointer } from "../paneCameras"
import { sceneRegistry } from "../sceneRegistry"
import { fitTransforms, type PickerRequest, snapConfigOf, useEditor } from "../store"
import { type DragKeyState, handleDragKey, seedDragKeys, syncDragKeys } from "./dragKeys"
import { dragKeysOf, endSnapDisplay, flipOfferOf, MoveSession, previewMove } from "./moveSession"
import { anchorUnder, hitUnder, pickedOf } from "./pickTarget"
import { bodyDrags, dragTargetOf, selectionSnapStart } from "./selectionStart"
import { snapMarks } from "./snapMarks"
import { gameRayOf, toGame } from "./snapView"

/** How far a press on the selection moves before it's a drag and not a click. */
const DRAG_SLOP_PX = 4

/** How far a resting pointer can wander and still be hovering. */
const HOVER_SLOP_PX = 4

/** How long the pointer pauses before the item under it counts as hovered. */
const HOVERED_ITEM_MS = 80

interface Pressed {
  readonly x: number
  readonly y: number
  readonly pointerId: number
  readonly slot: number
  readonly e: PointerEvent
}

interface BodyDrag {
  readonly session: MoveSession
  readonly pointerId: number
  readonly slot: number
  readonly startTransforms: ReadonlyMap<string, UeTransform>
  /** The selection as units at drag start, which the pivot setting applies the delta by. */
  readonly selection: SelectionUnits
  readonly pivotMode: PivotMode
  readonly keys: DragKeyState
  last: ReadonlyMap<string, UeTransform> | undefined
  lastEvent: PointerEvent
}

/** What a body drag slides on: the ground in perspective, the view's plane in orthographic. */
const surfaceOf = (pane: PaneCamera): Constraint => ({
  kind: "surface",
  normal: pane.view === undefined
    ? { x: 0, y: 0, z: 1 }
    : toGame(pane.camera.getWorldDirection(new THREE.Vector3()).normalize())
})

const itemUnder = (el: HTMLElement, e: PointerEvent, raycaster: THREE.Raycaster, slot?: number): string | null => {
  const { ndc, pane } = panePointer(el, e, slot)
  raycaster.setFromCamera(ndc, pane.camera)
  const root = sceneRegistry.itemsRoot
  for (const hit of root === null ? [] : raycaster.intersectObject(root, true)) {
    for (let at: THREE.Object3D | null = hit.object; at !== null; at = at.parent) {
      const id: unknown = at.userData["itemId"]
      if (typeof id === "string") return id
    }
  }
  return null
}

export function SnapInput() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    let pressed: Pressed | null = null
    let drag: BodyDrag | null = null
    let hoverTimer: ReturnType<typeof setTimeout> | undefined
    let itemTimer: ReturnType<typeof setTimeout> | undefined
    let hoverAt: { x: number; y: number } | undefined

    sceneRegistry.bodyDragActive = () => drag !== null

    const end = () => {
      drag = null
      useEditor.getState().setPreview(null)
      endSnapDisplay()
    }

    /** A drag let go of without landing (Escape, a lost pointer, unmount). Its tracking points go, as after a landing. */
    const cancel = () => {
      end()
      useEditor.getState().clearTracked()
    }

    const beginDrag = (from: Pressed): BodyDrag | undefined => {
      const s = useEditor.getState()
      const target = dragTargetOf(s)
      if (target === undefined) return undefined
      const { transforms } = target
      const pointer = panePointer(el, from.e, from.slot)
      raycaster.setFromCamera(pointer.ndc, pointer.pane.camera)
      // a body drag goes along the world's axes, so every unit takes it alike and any of them can lead it
      const selection = selectionSnapStart(s, transforms, leadingKeys(target.selection, "together"))
      const session = new MoveSession({
        pane: pointer.pane,
        keys: new Set(transforms.keys()),
        pivot: target.pivot,
        box: selection.box,
        ends: selection.ends,
        rotation: target.rotation,
        constraint: surfaceOf(pointer.pane),
        ray: gameRayOf(raycaster.ray),
        px: pointer.px
      })
      const begun: BodyDrag = {
        session,
        pointerId: from.pointerId,
        slot: from.slot,
        startTransforms: transforms,
        selection: target.selection,
        pivotMode: s.pivotMode,
        keys: seedDragKeys(from.e),
        last: undefined,
        lastEvent: from.e
      }
      drag = begun
      try {
        el.setPointerCapture(from.pointerId)
      } catch {
        // synthetic events (automation) have no capturable pointer
      }
      return begun
    }

    const moveDrag = (active: BodyDrag, e: PointerEvent) => {
      active.lastEvent = e
      const s = useEditor.getState()
      const pointer = panePointer(el, e, active.slot)
      raycaster.setFromCamera(pointer.ndc, pointer.pane.camera)
      const { delta } = active.session.update(
        gameRayOf(raycaster.ray),
        pointer.px,
        dragKeysOf(s.keybinds, active.keys.pressed)
      )
      if (delta === undefined) return
      const next = fitTransforms(s, applyDelta(active.selection, active.pivotMode, active.startTransforms, delta))
      active.last = next
      previewMove(next, delta)
    }

    const stopHover = () => {
      clearTimeout(hoverTimer)
      hoverAt = undefined
    }

    /** A pointer that has come to rest acquires what is under it, when tracking is on. */
    const trackHover = (e: PointerEvent) => {
      const s = useEditor.getState()
      const config = snapConfigOf(s)
      const { acquire, enabled, hoverMs } = config.targets.tracking
      if (!enabled || !config.enabled || (acquire === "shift" && !e.shiftKey) || s.picker !== null) {
        stopHover()
        return
      }
      if (hoverAt !== undefined && Math.hypot(e.clientX - hoverAt.x, e.clientY - hoverAt.y) <= HOVER_SLOP_PX) return
      clearTimeout(hoverTimer)
      hoverAt = { x: e.clientX, y: e.clientY }
      const at = { clientX: e.clientX, clientY: e.clientY }
      const dragging = sceneRegistry.gizmoDragActive()
      hoverTimer = setTimeout(() => {
        // a pause in a drag that has ended since goes with the points that drag let go of
        if (dragging && !sceneRegistry.gizmoDragActive()) {
          stopHover()
          return
        }
        const now = useEditor.getState()
        const { pane, px } = panePointer(el, at)
        const hit = anchorUnder(now, pane, px, new Set(drag === null ? [] : drag.startTransforms.keys()))
        if (hit !== undefined) now.acquireTracked({ at: hit.landing, label: hit.label }, hit.item)
      }, hoverMs)
    }

    /** Which item shows its open ends: asked once the pointer pauses, as a raycast per move costs a large map too much. */
    const followHover = (e: PointerEvent) => {
      clearTimeout(itemTimer)
      if (snapConfigOf(useEditor.getState()).targets.connectors.showOpenEnds !== "hover" || e.buttons !== 0) return
      itemTimer = setTimeout(() => {
        const s = useEditor.getState()
        const key = itemUnder(el, e, raycaster)
        if (key !== s.hoveredItem) s.setHoveredItem(key)
      }, HOVERED_ITEM_MS)
    }

    const showPick = (picker: PickerRequest, e: PointerEvent) => {
      const s = useEditor.getState()
      const { pane, px } = panePointer(el, e)
      const hit = hitUnder(s, pane, px, picker.accepts)
      snapMarks.set(hit?.marks ?? [], hit?.landing)
      s.setSnapFeedback(hit === undefined ? null : { label: hit.label, base: "Pick" })
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const s = useEditor.getState()
      const { picker } = s
      if (picker !== null) {
        const { pane, px, slot } = panePointer(el, e)
        s.setActivePane(slot)
        const hit = hitUnder(s, pane, px, picker.accepts)
        e.stopImmediatePropagation()
        e.preventDefault()
        if (hit === undefined) return
        s.setPicker(null)
        endSnapDisplay()
        picker.onPick(pickedOf(s, hit))
        return
      }
      if (sceneRegistry.gizmoActive() || s.selectedIds.length === 0) return
      if (s.tool !== "select" && s.tool !== "translate") return
      if (sceneRegistry.isNavigationChord(mouseChordOf(e)) || e.ctrlKey || e.shiftKey || e.altKey) return
      const slot = panePointer(el, e).slot
      const key = itemUnder(el, e, raycaster, slot)
      if (key === null || !s.selectedIds.includes(key) || !bodyDrags(s)) return
      pressed = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, slot, e }
    }

    const onPointerMove = (e: PointerEvent) => {
      const s = useEditor.getState()
      if (s.picker !== null) {
        showPick(s.picker, e)
        return
      }
      trackHover(e)
      followHover(e)
      if (drag !== null) {
        syncDragKeys(drag.keys, e)
        moveDrag(drag, e)
        return
      }
      if (pressed === null) return
      if ((e.buttons & 1) === 0) {
        pressed = null
        return
      }
      if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) <= DRAG_SLOP_PX) return
      const from = pressed
      pressed = null
      const begun = beginDrag(from)
      if (begun !== undefined) moveDrag(begun, e)
    }

    const onPointerUp = (e: PointerEvent) => {
      pressed = null
      const active = drag
      if (active === null) return
      e.stopImmediatePropagation()
      const { last, session, startTransforms } = active
      const options = session.commitOptions(startTransforms.size)
      const offer = flipOfferOf(session.current, [...startTransforms.keys()])
      end()
      // the drag is over first, so the capture this lets go of doesn't cancel it
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (last !== undefined) {
        useEditor.getState().setFlipOffer(offer)
        transformSelection(last, options)
      }
      useEditor.getState().clearTracked()
    }

    /** The pointer gone from under a drag (the system took it, or the capture was lost) cancels it. */
    const onPointerLost = (e: PointerEvent) => {
      if (e.pointerId === pressed?.pointerId) pressed = null
      if (drag?.pointerId !== e.pointerId) return
      cancel()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const s = useEditor.getState()
      if (s.picker !== null && e.code === "Escape") {
        e.preventDefault()
        e.stopImmediatePropagation()
        s.picker.onCancel?.()
        s.setPicker(null)
        endSnapDisplay()
        return
      }
      const active = drag
      if (active === null) return
      if (handleDragKey(active.keys, active.session, e, s.keybinds)) {
        moveDrag(active, active.lastEvent)
        return
      }
      if (e.code !== "Escape" && !s.keybinds.deselect.includes(chordOf(e))) return
      e.preventDefault()
      e.stopImmediatePropagation()
      cancel()
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const active = drag
      if (active === null) return
      active.keys.pressed.delete(e.code)
      moveDrag(active, active.lastEvent)
    }

    const listening = new AbortController()
    const { signal } = listening
    el.addEventListener("pointerdown", onPointerDown, { capture: true, signal })
    el.addEventListener("pointermove", onPointerMove, { signal })
    el.addEventListener("pointerup", onPointerUp, { capture: true, signal })
    el.addEventListener("pointercancel", onPointerLost, { signal })
    el.addEventListener("lostpointercapture", onPointerLost, { signal })
    el.addEventListener("pointerleave", stopHover, { signal })
    window.addEventListener("keydown", onKeyDown, { capture: true, signal })
    window.addEventListener("keyup", onKeyUp, { capture: true, signal })
    return () => {
      listening.abort()
      stopHover()
      clearTimeout(itemTimer)
      sceneRegistry.bodyDragActive = () => false
      if (drag !== null) cancel()
    }
  }, [gl])
  return null
}
