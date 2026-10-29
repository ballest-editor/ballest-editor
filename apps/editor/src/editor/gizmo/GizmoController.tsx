import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { type Quat4, ueToScene, ueToThreeVector, type UeTransform, type Vec3 } from "../../domain/coords"
import { applyGroupDelta } from "../../domain/groupTransform"
import { chordOf } from "../../domain/Keybinds"
import { transformSelection } from "../actions"
import { AXIS_COLORS } from "../axisColors"
import { sceneRegistry } from "../sceneRegistry"
import { activeId, shownTransform, useEditor } from "../store"
import { dragAxisWorld, dragDelta, type DragStart, type PointerSample } from "./drag"
import { GizmoObject, toolHandles } from "./handles"
import { worldPerPixel } from "./math"

interface ActiveDrag {
  readonly id: string
  readonly start: DragStart
  /**
   * Every dragged item's transform at drag start, and the pivot they turn about. An Alt+drag
   * duplicate swaps the selection for its copies on the first move.
   */
  startTransforms: ReadonlyMap<string, UeTransform>
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
  /** Where the gizmo sits and the selection turns: the active item's origin, in game space. */
  readonly pivot: Vec3
  /** The active item's rotation: the frame of the local axes. */
  readonly rotation: Quat4
}

/**
 * What the gizmo acts on: the selected items that are in the scene, framed on the active
 * (last selected) item like the game's editor.
 */
const currentTarget = (): GizmoTarget | undefined => {
  const s = useEditor.getState()
  const transforms = new Map(s.selectedIds.flatMap((id) => {
    const t = shownTransform(s, id)
    return t === undefined || !sceneRegistry.objects.has(id) ? [] : [[id, t] as const]
  }))
  const id = activeId(s)
  const active = (id === undefined ? undefined : transforms.get(id)) ?? transforms.values().next().value
  return active === undefined ? undefined : { transforms, pivot: active.translation, rotation: active.rotation }
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
 */
export function GizmoController() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const tool = useEditor((s) => s.tool)
  const gizmo = useMemo(() => (tool === "select" ? null : new GizmoObject(toolHandles[tool])), [tool])
  const hovered = useRef<string | null>(null)
  const drag = useRef<ActiveDrag | null>(null)

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
    // The Canvas camera is perspective; gizmo sizing needs its fov.
    if (gizmo === null || !(camera instanceof THREE.PerspectiveCamera)) return
    const target = currentTarget()
    gizmo.visible = target !== undefined
    if (target === undefined) {
      hovered.current = null
      return
    }
    const origin = toWorld(target.pivot)
    const height = gl.domElement.clientHeight
    gizmo.update(
      {
        origin,
        worldPerPixel: worldPerPixel(camera, origin, height),
        gameRotation: target.rotation,
        space: useEditor.getState().gizmoSpace,
        cameraQuaternion: camera.quaternion,
        toCamera: camera.position.clone().sub(origin).normalize()
      },
      hovered.current,
      drag.current?.id ?? null
    )
  })

  useEffect(() => {
    if (gizmo === null) return
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()

    const sample = (e: PointerEvent): PointerSample => {
      const rect = el.getBoundingClientRect()
      const px = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      raycaster.setFromCamera(new THREE.Vector2((px.x / rect.width) * 2 - 1, -(px.y / rect.height) * 2 + 1), camera)
      return { rayOrigin: raycaster.ray.origin.clone(), rayDir: raycaster.ray.direction.clone(), px }
    }
    const pick = (e: PointerEvent): string | null => {
      if (!gizmo.visible) return null
      sample(e)
      const hit = raycaster.intersectObjects([...gizmo.hitMeshes], false)[0]
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
      const id = pick(e)
      const target = currentTarget()
      const spec = gizmo.handle(id)?.spec
      if (id === null || target === undefined || spec === undefined) return
      e.stopImmediatePropagation() // the gizmo wins over camera drags and click-select
      e.preventDefault()
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events (automation) have no capturable pointer
      }
      const originWorld = toWorld(target.pivot)
      const projected = originWorld.clone().project(camera)
      const rect = el.getBoundingClientRect()
      const start: DragStart = {
        spec,
        space: useEditor.getState().gizmoSpace,
        frameRotation: target.rotation,
        originWorld,
        originPx: { x: ((projected.x + 1) / 2) * rect.width, y: ((1 - projected.y) / 2) * rect.height },
        toCamera: camera.position.clone().sub(originWorld).normalize(),
        pointer: sample(e)
      }
      const { settings } = useEditor.getState()
      const duplicate = e.altKey && settings.general.altDragDuplicates
          && (spec.kind === "translateAxis" || spec.kind === "translatePlane")
        ? "pending"
        : undefined
      drag.current = { id, start, startTransforms: target.transforms, pivot: target.pivot, last: undefined, duplicate }
      const axis = spec.kind === "translateAxis" || spec.kind === "scaleAxis" || spec.kind === "rotateAxis"
        ? dragAxisWorld(start)
        : undefined
      gizmo.setGuide(originWorld, axis, spec.axis === undefined ? undefined : new THREE.Color(AXIS_COLORS[spec.axis]))
    }

    const onPointerMove = (e: PointerEvent) => {
      const active = drag.current
      if (active === null) {
        if (e.buttons === 0) hovered.current = pick(e)
        return
      }
      const { snapping } = useEditor.getState().settings
      const grid = snapping.enabled ? { size: snapping.gridSize, pivot: active.pivot } : undefined
      const delta = dragDelta(active.start, sample(e), grid)
      if (delta === undefined) return
      if (active.duplicate === "pending") {
        // The copies start where the selection is; the selection itself stays put.
        const copies = useEditor.getState().beginDuplicateDrag()
        active.duplicate = copies === undefined ? undefined : "copied"
        if (copies !== undefined) {
          active.startTransforms = new Map([...copies].flatMap(([source, copy]) => {
            const t = active.startTransforms.get(source)
            return t === undefined ? [] : [[copy, t] as const]
          }))
        }
      }
      const next = new Map([...active.startTransforms].map(([id, t]) => [id, applyGroupDelta(t, active.pivot, delta)]))
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
  }, [gizmo, camera, gl])

  return gizmo === null ? null : <primitive object={gizmo} />
}
