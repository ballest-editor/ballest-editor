import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { type UeTransform, ueToScene } from "../../domain/coords"
import { chordOf } from "../../domain/Keybinds"
import { sceneRegistry } from "../sceneRegistry"
import { selectedIndex, useEditor } from "../store"
import { dragAxisWorld, type DragStart, dragTransform, type PointerSample } from "./drag"
import { AXIS_COLORS, GizmoObject, toolHandles } from "./handles"
import { worldPerPixel } from "./math"

interface ActiveDrag {
  readonly id: string
  readonly start: DragStart
  last: UeTransform | undefined
}

const applyToObject = (object: THREE.Object3D, transform: UeTransform) => {
  const s = ueToScene(transform)
  object.position.set(...s.position)
  object.quaternion.set(...s.quaternion)
  object.scale.set(...s.scale)
  object.updateMatrixWorld(true)
}

/** The item transform the gizmo should show: the live drag preview, else the document. */
const currentTransform = (): UeTransform | undefined => {
  const s = useEditor.getState()
  if (s.selectedId !== null && s.preview?.id === s.selectedId) return s.preview.transform
  return s.doc.map.items[selectedIndex(s)]?.itemTransform
}

/**
 * Hosts the Blender-style gizmo for the current tool: hover picking, dragging with a live
 * preview (inspector stays in sync), one undo entry per drag, Escape to cancel.
 */
export function GizmoController() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
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
    return () => {
      sceneRegistry.gizmoActive = () => false
    }
  }, [])

  useFrame(() => {
    if (gizmo === null) return
    const { selectedId } = useEditor.getState()
    const object = selectedId === null ? undefined : sceneRegistry.objects.get(selectedId)
    const transform = currentTransform()
    gizmo.visible = object !== undefined && transform !== undefined
    if (object === undefined || transform === undefined) {
      hovered.current = null
      return
    }
    const origin = object.getWorldPosition(new THREE.Vector3())
    const height = gl.domElement.clientHeight
    gizmo.update(
      {
        origin,
        worldPerPixel: worldPerPixel(camera, origin, height),
        gameRotation: transform.rotation,
        cameraQuaternion: camera.quaternion
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
      return (hit?.object.userData["handleId"] as string | undefined) ?? null
    }
    const selectedObject = () => {
      const { selectedId } = useEditor.getState()
      return selectedId === null ? undefined : sceneRegistry.objects.get(selectedId)
    }
    const endDrag = () => {
      drag.current = null
      gizmo.setGuide(undefined, undefined)
      useEditor.getState().setPreview(null)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const id = pick(e)
      const object = selectedObject()
      const transform = currentTransform()
      const spec = gizmo.handle(id)?.spec
      if (id === null || object === undefined || transform === undefined || spec === undefined) return
      e.stopImmediatePropagation() // the gizmo wins over camera drags and click-select
      e.preventDefault()
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events (automation) have no capturable pointer
      }
      const originWorld = object.getWorldPosition(new THREE.Vector3())
      const projected = originWorld.clone().project(camera)
      const rect = el.getBoundingClientRect()
      const start: DragStart = {
        spec,
        transform,
        originWorld,
        originPx: { x: ((projected.x + 1) / 2) * rect.width, y: ((1 - projected.y) / 2) * rect.height },
        toCamera: camera.position.clone().sub(originWorld).normalize(),
        pointer: sample(e)
      }
      drag.current = { id, start, last: undefined }
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
      const next = dragTransform(active.start, sample(e))
      const object = selectedObject()
      if (next === undefined || object === undefined) return
      active.last = next
      applyToObject(object, next)
      const { selectedId, setPreview } = useEditor.getState()
      if (selectedId !== null) setPreview({ id: selectedId, transform: next })
    }

    const onPointerUp = (e: PointerEvent) => {
      const active = drag.current
      if (active === null) return
      e.stopImmediatePropagation()
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      const { selectedId, transformItem } = useEditor.getState()
      endDrag()
      if (active.last !== undefined && selectedId !== null) transformItem(selectedId, active.last) // one undo entry
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const active = drag.current
      if (active === null) return
      if (e.code !== "Escape" && chordOf(e) !== useEditor.getState().keybinds.deselect) return
      e.preventDefault()
      e.stopImmediatePropagation() // don't also deselect
      const object = selectedObject()
      if (object !== undefined) applyToObject(object, active.start.transform)
      endDrag()
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
      if (drag.current !== null) endDrag()
      hovered.current = null
    }
  }, [gizmo, camera, gl])

  return gizmo === null ? null : <primitive object={gizmo} />
}
