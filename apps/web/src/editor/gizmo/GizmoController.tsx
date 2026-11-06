import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { type Quat4, ueToScene, ueToThreeVector, type UeTransform, type Vec3 } from "../../domain/coords"
import { applyGroupDelta } from "../../domain/groupTransform"
import { chordOf } from "../../domain/Keybinds"
import { localToWorld } from "../../domain/pivot"
import { transformSelection } from "../actions"
import { type PaneCamera, type PanePointer, panePointer } from "../paneCameras"
import { useBeforePaneDraw } from "../PaneRenderer"
import { sceneRegistry } from "../sceneRegistry"
import { activeId, fitTransforms, pivotOf, shownTransform, useEditor } from "../store"
import { useDarkTheme } from "../theme"
import { dragAxisWorld, dragDelta, type DragStart, type PointerSample } from "./drag"
import { GizmoObject, toolHandles } from "./handles"

interface ActiveDrag {
  readonly id: string
  /** The pane the drag started in: it measures the pointer against that pane's camera to the end. */
  readonly slot: number
  readonly start: DragStart
  /**
   * Every dragged item's transform at drag start, and the pivot they turn about. An Alt+drag
   * duplicate swaps the selection for its copies on the first move.
   */
  startTransforms: ReadonlyMap<string, UeTransform>
  /** Each dragged item's own pivot (local, unscaled cm), which a scale keeps in place. */
  localPivots: ReadonlyMap<string, Vec3>
  readonly pivot: Vec3
  last: ReadonlyMap<string, UeTransform> | undefined
  /** "pending": an Alt+drag that copies the selection once it moves; "copied": it has. */
  duplicate: "pending" | "copied" | undefined
}

const applyToObject = (object: THREE.Object3D, transform: UeTransform) => {
  const s = ueToScene(transform)
  object.position.set(...s.position)
  object.quaternion.set(...s.quaternion)
  object.scale.set(...s.scale)
  object.updateMatrix() // an item's matrix is only worked out when it moves (see ItemObject)
  object.updateMatrixWorld(true)
}

/** Moves each item's scene object (ahead of React, which follows through the preview). */
const applyToObjects = (transforms: ReadonlyMap<string, UeTransform>) => {
  for (const [id, transform] of transforms) {
    const object = sceneRegistry.objects.get(id)
    if (object !== undefined) applyToObject(object, transform)
  }
}

interface GizmoTarget {
  /** The selected items' shown transforms (live preview, else the document). */
  readonly transforms: ReadonlyMap<string, UeTransform>
  /** Each one's pivot in its local frame (unscaled cm), which a scale keeps in place. */
  readonly localPivots: ReadonlyMap<string, Vec3>
  /** Where the gizmo sits and the selection turns: the active item's pivot, in game space. */
  readonly pivot: Vec3
  /** The active item's rotation: the frame of the local axes. */
  readonly rotation: Quat4
}

/**
 * What the gizmo acts on: the selected items that are in the scene, framed on the active
 * (last selected) item like the game's editor, at that item's pivot.
 */
const currentTarget = (): GizmoTarget | undefined => {
  const s = useEditor.getState()
  const transforms = new Map(s.selectedIds.flatMap((id) => {
    const t = shownTransform(s, id)
    return t === undefined || !sceneRegistry.objects.has(id) ? [] : [[id, t] as const]
  }))
  const localPivots = new Map([...transforms.keys()].map((id) => [id, pivotOf(s, id).localPosition]))
  const active = activeId(s)
  const frameId = active !== undefined && transforms.has(active) ? active : transforms.keys().next().value
  const frame = frameId === undefined ? undefined : transforms.get(frameId)
  const localPivot = frameId === undefined ? undefined : localPivots.get(frameId)
  if (frame === undefined || localPivot === undefined) return undefined
  return { transforms, localPivots, pivot: localToWorld(frame, localPivot), rotation: frame.rotation }
}

/** A drag's per-item values re-keyed from each source id to its copy's. */
function byCopy<A>(copies: ReadonlyMap<string, string>, bySource: ReadonlyMap<string, A>): ReadonlyMap<string, A> {
  return new Map([...copies].flatMap(([source, copy]) => {
    const value = bySource.get(source)
    return value === undefined ? [] : [[copy, value] as const]
  }))
}

const toWorld = (v: Vec3) => {
  const w = ueToThreeVector(v)
  return new THREE.Vector3(w.x, w.y, w.z)
}

/**
 * Hosts the Blender-style gizmo for the current tool: hover picking, dragging with a live
 * preview (inspector stays in sync), one undo entry per drag, Escape to cancel. The gizmo
 * sits on the active item and a drag moves every selected item together. Alt+dragging a
 * translate handle moves a copy instead and leaves the selection in place, like the game.
 * Every pane shows it, placed for that pane's camera just before it draws; the one under the
 * pointer picks and drags it, and shows the hover.
 */
export function GizmoController() {
  const gl = useThree((s) => s.gl)
  const tool = useEditor((s) => s.tool)
  const gizmo = useMemo(() => (tool === "select" ? null : new GizmoObject(toolHandles[tool])), [tool])
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  useEffect(() => gizmo?.setDark(dark), [gizmo, dark])
  const hovered = useRef<string | null>(null)
  /** The pane `hovered` is in. */
  const hoverSlot = useRef<number | null>(null)
  const drag = useRef<ActiveDrag | null>(null)
  /** What the gizmo acts on this frame; every pane places it from this. */
  const frameTarget = useRef<GizmoTarget | undefined>(undefined)

  useEffect(() => {
    sceneRegistry.gizmo = gizmo
    return () => {
      sceneRegistry.gizmo = null
      gizmo?.dispose()
    }
  }, [gizmo])

  useEffect(() => {
    sceneRegistry.gizmoActive = () => hovered.current !== null || drag.current !== null
    sceneRegistry.gizmoDragActive = () => drag.current !== null
    return () => {
      sceneRegistry.gizmoActive = () => false
      sceneRegistry.gizmoDragActive = () => false
    }
  }, [])

  useFrame(() => {
    if (gizmo === null) return
    frameTarget.current = currentTarget()
    gizmo.visible = frameTarget.current !== undefined
    if (frameTarget.current === undefined) hovered.current = null
  })

  /** Sizes and turns the gizmo for one pane's camera. */
  const placeFor = (pane: PaneCamera, slot: number) => {
    const target = frameTarget.current
    if (gizmo === null || target === undefined) return
    const origin = toWorld(target.pivot)
    gizmo.update(
      {
        origin,
        worldPerPixel: pane.worldPerPixelAt(origin),
        gameRotation: target.rotation,
        space: useEditor.getState().gizmoSpace,
        cameraQuaternion: pane.camera.quaternion,
        toCamera: pane.toCameraFrom(origin)
      },
      slot === hoverSlot.current ? hovered.current : null,
      drag.current?.id ?? null
    )
  }
  const place = useRef(placeFor)
  useEffect(() => {
    place.current = placeFor
  })
  useBeforePaneDraw(placeFor)

  useEffect(() => {
    if (gizmo === null) return
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()

    const sample = ({ ndc, pane, px }: PanePointer): PointerSample => {
      raycaster.setFromCamera(ndc, pane.camera)
      return { rayOrigin: raycaster.ray.origin.clone(), rayDir: raycaster.ray.direction.clone(), px }
    }
    /** The handle under the pointer, as its pane shows it: panes differ in the gizmo's size and in the handles shown. */
    const pick = (pointer: PanePointer): string | null => {
      if (!gizmo.visible) return null
      place.current(pointer.pane, pointer.slot)
      sample(pointer)
      const hit = raycaster.intersectObjects([...gizmo.pickableMeshes], false)[0]
      const handleId: unknown = hit?.object.userData["handleId"]
      return typeof handleId === "string" ? handleId : null
    }
    const endDrag = () => {
      drag.current = null
      gizmo.setGuide(undefined, undefined)
      useEditor.getState().setPreview(null)
    }
    /** Drops the copies of an Alt+drag that is cancelled (Escape, unmount). */
    const cancelDuplicate = (active: ActiveDrag) => {
      if (active.duplicate === "copied") useEditor.getState().endDuplicateDrag(null)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const pointer = panePointer(el, e)
      const id = pick(pointer)
      const target = currentTarget()
      const spec = gizmo.handle(id)?.spec
      if (id === null || target === undefined || spec === undefined) return
      const { camera } = pointer.pane
      e.stopImmediatePropagation() // the gizmo wins over camera drags and click-select
      e.preventDefault()
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events (automation) have no capturable pointer
      }
      const originWorld = toWorld(target.pivot)
      const projected = originWorld.clone().project(camera)
      const start: DragStart = {
        spec,
        space: useEditor.getState().gizmoSpace,
        frameRotation: target.rotation,
        originWorld,
        originPx: {
          x: ((projected.x + 1) / 2) * pointer.pane.width,
          y: ((1 - projected.y) / 2) * pointer.pane.height
        },
        toCamera: pointer.pane.toCameraFrom(originWorld),
        pointer: sample(pointer)
      }
      const { settings } = useEditor.getState()
      const duplicate = e.altKey && settings.general.altDragDuplicates
          && (spec.kind === "translateAxis" || spec.kind === "translatePlane")
        ? "pending"
        : undefined
      drag.current = {
        id,
        slot: pointer.slot,
        start,
        startTransforms: target.transforms,
        localPivots: target.localPivots,
        pivot: target.pivot,
        last: undefined,
        duplicate
      }
      const axis = spec.kind === "translateAxis" || spec.kind === "scaleAxis" || spec.kind === "rotateAxis"
        ? dragAxisWorld(start)
        : undefined
      gizmo.setGuide(originWorld, axis, spec.axis)
    }

    const onPointerMove = (e: PointerEvent) => {
      const active = drag.current
      if (active === null) {
        if (e.buttons === 0) {
          const pointer = panePointer(el, e)
          hoverSlot.current = pointer.slot
          hovered.current = pick(pointer)
        }
        return
      }
      const { snapping } = useEditor.getState().settings
      const delta = dragDelta(active.start, sample(panePointer(el, e, active.slot)), {
        grid: snapping.enabled ? { size: snapping.gridSize, pivot: active.pivot } : undefined,
        rotationStep: snapping.rotationEnabled ? snapping.rotationStep : undefined
      })
      if (delta === undefined) return
      if (active.duplicate === "pending") {
        // The copies start where the selection is; the selection itself stays put.
        const copies = useEditor.getState().beginDuplicateDrag()
        active.duplicate = copies === undefined ? undefined : "copied"
        if (copies !== undefined) {
          active.startTransforms = byCopy(copies, active.startTransforms)
          active.localPivots = byCopy(copies, active.localPivots)
        }
      }
      const next = fitTransforms(
        useEditor.getState(),
        new Map(
          [...active.startTransforms].map((
            [id, t]
          ) => [id, applyGroupDelta(t, active.pivot, delta, active.localPivots.get(id))])
        )
      )
      active.last = next
      applyToObjects(next)
      useEditor.getState().setPreview(next)
    }

    const onPointerUp = (e: PointerEvent) => {
      const active = drag.current
      if (active === null) return
      e.stopImmediatePropagation()
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      endDrag()
      if (active.duplicate === "copied") {
        // the copy and the move are one undo entry; refused, the copies go
        useEditor.getState().endDuplicateDrag(active.last ?? null)
        return
      }
      if (active.last === undefined) return
      // One undo entry for the whole selection. If the document refuses it, the scene objects
      // go back where they started.
      if (!transformSelection(active.last)) applyToObjects(active.startTransforms)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const active = drag.current
      if (active === null) return
      if (e.code !== "Escape" && !useEditor.getState().keybinds.deselect.includes(chordOf(e))) return
      e.preventDefault()
      e.stopImmediatePropagation() // don't also deselect
      applyToObjects(active.startTransforms)
      endDrag()
      cancelDuplicate(active)
    }

    el.addEventListener("pointerdown", onPointerDown, { capture: true })
    el.addEventListener("pointermove", onPointerMove)
    el.addEventListener("pointerup", onPointerUp, { capture: true })
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true })
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerup", onPointerUp, { capture: true })
      window.removeEventListener("keydown", onKeyDown, { capture: true })
      const active = drag.current
      if (active !== null) {
        endDrag()
        cancelDuplicate(active)
      }
      hovered.current = null
    }
  }, [gizmo, gl])

  return gizmo === null ? null : <primitive object={gizmo} />
}
