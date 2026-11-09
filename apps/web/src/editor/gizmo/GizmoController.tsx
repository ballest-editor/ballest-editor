import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { threeToUeVector, ueToScene, type UeTransform, type Vec3 } from "../../domain/coords"
import { selectedGroupIds } from "../../domain/groupSelection"
import type { GroupDelta } from "../../domain/groupTransform"
import { chordOf } from "../../domain/Keybinds"
import { gizmoScaleOf } from "../../domain/Settings"
import { type SnapTransform, turnSnapOf } from "../../domain/snapConfig"
import { type ScaleStop, snappedScale, turnLanding, turnReach, type TurnStop } from "../../domain/snapRotate"
import { quatFromAxisAngle } from "../../domain/ueMath"
import {
  applyDelta,
  leadingKeys,
  movedAlikeKeys,
  type PivotMode,
  type SelectionUnits,
  turnAccumulates
} from "../../domain/units"
import { transformSelection } from "../actions"
import { type PaneCamera, type PanePointer, panePointer } from "../paneCameras"
import { useBeforePaneDraw } from "../PaneRenderer"
import { sceneRegistry } from "../sceneRegistry"
import { type DragKeyState, handleDragKey, releaseDragKey, seedDragKeys, syncDragKeys } from "../snap/dragKeys"
import {
  dragKeysOf,
  endSnapDisplay,
  flipOfferOf,
  MoveSession,
  previewMove,
  showSnap,
  turnCommitOptions
} from "../snap/moveSession"
import { type DragTarget, dragTargetOf, selectionSnapStart } from "../snap/selectionStart"
import { ownSnapItemsOf, snapItemsOf } from "../snap/snapScene"
import { gameRayOf, snapViewOf, toThree } from "../snap/snapView"
import { allTurnStopsOf, reachAlong, scaleStopsOf, turnStopsFrom } from "../snap/turnScale"
import { fitTransforms, selectionUnits, shownGizmoSpace, snapConfigOf, useEditor } from "../store"
import { useDarkTheme } from "../theme"
import {
  constraintOf,
  dragAxisWorld,
  type DragStart,
  localFrameOf,
  type PointerSample,
  scaleOf,
  stepAxesOf,
  turnOf
} from "./drag"
import { GizmoObject, type HandleSpec, SIZE, toolHandles } from "./handles"

interface ActiveDrag {
  readonly id: string
  readonly pointerId: number
  /** The pane the drag started in: it measures the pointer against that pane's camera to the end. */
  readonly slot: number
  readonly start: DragStart
  /**
   * Every dragged item's transform at drag start, and the pivot they turn about. An Alt+drag
   * duplicate swaps the selection for its copies on the first move.
   */
  startTransforms: ReadonlyMap<string, UeTransform>
  readonly pivot: Vec3
  /** The selection as units at drag start, which the pivot setting applies the delta by. */
  selection: SelectionUnits
  readonly pivotMode: PivotMode
  last: ReadonlyMap<string, UeTransform> | undefined
  /** "pending": an Alt+drag that copies the selection once it moves; "copied": it has. */
  duplicate: "pending" | "copied" | undefined
  /** The snapping session of a move; a turn and a scale keep what they can meet instead. */
  readonly move: MoveSession | undefined
  readonly turn: TurnSession | undefined
  readonly stops: ReadonlyArray<ScaleStop>
  /** How far the active item's scaled face reaches from the pivot at the drag's start, in cm. */
  readonly reach: number
  /** The active item's scale along the handle's axis at the drag's start. */
  readonly scaleFrom: number
  /** The cm the threshold covers at the pivot. */
  readonly rangeCm: number
  readonly keys: DragKeyState
  /** The last pointer position, to go again when a key changes with the pointer still. */
  lastEvent: { readonly clientX: number; readonly clientY: number } | undefined
}

/** What a turn can stop on, and where it has got to (docs/SNAPPING.md § Affect). */
interface TurnSession {
  readonly stops: ReadonlyArray<TurnStop>
  /** Radians past a stop the pointer can go and hold it, and ahead of it that reach it: pixels along the ring. */
  readonly reach: number
  readonly nudge: number
  /** The last sample's free angle, and the stop it landed on. */
  from: number
  on: TurnStop | undefined
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

/**
 * What the gizmo acts on: the selected items that are in the scene, at the selection's pivot
 * like the game's editor.
 */
const currentTarget = (): DragTarget | undefined => {
  const s = useEditor.getState()
  // Settings › Display can keep the gizmo off a whole group, which is moved from the outline instead.
  if (
    !s.settings.gizmo.showForGroups &&
    selectedGroupIds(s.doc.structure.tree, s.selectedIds, s.enteredGroupId).length > 0
  ) {
    return undefined
  }
  return dragTargetOf(s)
}

/** A drag's start transforms re-keyed from each source id to its copy's. */
const byCopy = (
  copies: ReadonlyMap<string, string>,
  bySource: ReadonlyMap<string, UeTransform>
): ReadonlyMap<string, UeTransform> =>
  new Map([...copies].flatMap(([source, copy]) => {
    const value = bySource.get(source)
    return value === undefined ? [] : [[copy, value] as const]
  }))

const isTranslate = ({ kind }: HandleSpec) => kind === "translateAxis" || kind === "translatePlane"

/** What a handle's drag does, for the keys it can take. */
const transformOf = ({ kind }: HandleSpec): SnapTransform =>
  kind === "rotateAxis" || kind === "rotateView"
    ? "turn"
    : kind === "scaleAxis" || kind === "scaleUniform"
    ? "scale"
    : "move"

const toWorld = toThree

const threeToGame = (v: THREE.Vector3): Vec3 => threeToUeVector({ x: v.x, y: v.y, z: v.z })

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
  // the select and paint tools have no gizmo
  const gizmo = useMemo(() => (tool === "select" || tool === "paint" ? null : new GizmoObject(toolHandles[tool])), [
    tool
  ])
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  useEffect(() => gizmo?.setDark(dark), [gizmo, dark])
  const hovered = useRef<string | null>(null)
  /** The pane `hovered` is in. */
  const hoverSlot = useRef<number | null>(null)
  const drag = useRef<ActiveDrag | null>(null)
  /** What the gizmo acts on this frame; every pane places it from this. */
  const frameTarget = useRef<DragTarget | undefined>(undefined)

  useEffect(() => {
    sceneRegistry.gizmo = gizmo
    return () => {
      sceneRegistry.gizmo = null
      gizmo?.dispose()
    }
  }, [gizmo])

  useEffect(() => {
    sceneRegistry.gizmoActive = () => hovered.current !== null || drag.current !== null
    sceneRegistry.gizmoDragActive = () => drag.current !== null || sceneRegistry.bodyDragActive()
    return () => {
      sceneRegistry.gizmoActive = () => false
      sceneRegistry.gizmoDragActive = () => sceneRegistry.bodyDragActive()
    }
  }, [])

  useFrame(() => {
    if (gizmo === null) return
    const target = currentTarget()
    // A group's bounds shift under a turn or scale, but what it turns and scales about doesn't.
    const held = drag.current !== null && !isTranslate(drag.current.start.spec) ? drag.current.pivot : undefined
    frameTarget.current = target === undefined || held === undefined ? target : { ...target, pivot: held }
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
        worldPerPixel: pane.worldPerPixelAt(origin) * gizmoScaleOf(useEditor.getState().settings.gizmo.size),
        gameRotation: target.rotation,
        space: shownGizmoSpace(useEditor.getState()),
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
      endSnapDisplay()
    }
    /**
     * A drag let go of without landing (Escape, a lost pointer, unmount): an Alt+drag's copies go, and its tracking points
     * as after a landing.
     */
    const cancelDrag = (active: ActiveDrag) => {
      endDrag()
      if (active.duplicate === "copied") useEditor.getState().endDuplicateDrag(null)
      useEditor.getState().clearTracked()
    }

    const onPointerDown = (e: PointerEvent) => {
      // a click for the target picker is the picker's, even over a handle
      if (e.button !== 0 || useEditor.getState().picker !== null) return
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
        space: shownGizmoSpace(useEditor.getState()),
        frameRotation: target.rotation,
        originWorld,
        originPx: {
          x: ((projected.x + 1) / 2) * pointer.pane.width,
          y: ((1 - projected.y) / 2) * pointer.pane.height
        },
        toCamera: pointer.pane.toCameraFrom(originWorld),
        pointer: sample(pointer)
      }
      const s = useEditor.getState()
      const { settings } = s
      const duplicate = e.altKey && settings.general.altDragDuplicates && isTranslate(spec) ? "pending" : undefined
      const config = snapConfigOf(s)
      const { pivotMode } = s
      const frame = localFrameOf(start)
      // a move along world axes is the same for every unit that takes it as dragged, so any of them can lead it
      const leads = isTranslate(spec) && frame === undefined
        ? movedAlikeKeys(target.selection, pivotMode)
        : leadingKeys(target.selection, pivotMode)
      const selection = selectionSnapStart(s, target.transforms, leads)
      const view = snapViewOf(pointer.pane)
      const rangeCm = config.threshold * view.cmPerPixelAt(target.pivot)
      const constraint = constraintOf(start)
      const axisWorld = spec.kind === "scaleAxis" ? dragAxisWorld(start) : undefined
      const scaleAxis = axisWorld === undefined ? undefined : threeToGame(axisWorld)
      const turnAxis = spec.kind === "rotateAxis" || spec.kind === "rotateView" ? dragAxisWorld(start) : undefined
      const items = constraint === undefined
        ? snapItemsOf(s, new Set(target.transforms.keys()), config.targets.mesh.sharpAngle)
        : []
      drag.current = {
        id,
        pointerId: e.pointerId,
        slot: pointer.slot,
        start,
        startTransforms: target.transforms,
        pivot: target.pivot,
        selection: target.selection,
        pivotMode,
        last: undefined,
        duplicate,
        move: constraint === undefined ? undefined : new MoveSession({
          pane: pointer.pane,
          keys: new Set(target.transforms.keys()),
          pivot: target.pivot,
          box: selection.box,
          ends: selection.ends,
          rotation: target.rotation,
          frame,
          constraint,
          stepAxes: stepAxesOf(start),
          ray: gameRayOf({ origin: start.pointer.rayOrigin, direction: start.pointer.rayDir }),
          px: start.pointer.px
        }),
        turn: turnAxis === undefined ? undefined : {
          // what a turn stops on assumes the unit ends up turned by the angle dragged, which a chain's pass goes past
          stops: turnAccumulates(target.selection, pivotMode) ? [] : allTurnStopsOf(
            config,
            {
              axis: threeToGame(turnAxis),
              pivot: target.pivot,
              rotation: target.rotation,
              own: ownSnapItemsOf(s, leads, config.targets.mesh.sharpAngle),
              ends: selection.ends
            },
            items,
            rangeCm
          ),
          ...turnReach(
            config.threshold,
            (spec.kind === "rotateView" ? SIZE.viewRing : SIZE.ring) * gizmoScaleOf(settings.gizmo.size)
          ),
          from: 0,
          on: undefined
        },
        stops: scaleAxis === undefined ? [] : scaleStopsOf(scaleAxis, target.pivot, selection.box, items),
        reach: scaleAxis === undefined ? 0 : reachAlong(selection.box, target.pivot, scaleAxis),
        scaleFrom: spec.axis === undefined ? target.active.scale3D.x : target.active.scale3D[spec.axis],
        rangeCm,
        keys: seedDragKeys(e, transformOf(spec)),
        lastEvent: undefined
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
      active.lastEvent = e
      syncDragKeys(active.keys, e)
      applySample(active, e)
    }

    /** What the drag does for the pointer at `e`, with the keys held now. */
    const deltaAt = (active: ActiveDrag, e: { readonly clientX: number; readonly clientY: number }) => {
      const s = useEditor.getState()
      const config = snapConfigOf(s)
      const pointer = panePointer(el, e, active.slot)
      const now = sample(pointer)
      const keys = dragKeysOf(s.keybinds, active.keys.pressed)
      if (active.move !== undefined) {
        return active.move.update(gameRayOf({ origin: now.rayOrigin, direction: now.rayDir }), now.px, keys).delta
      }
      const turn = turnOf(active.start, now)
      if (turn !== undefined && active.turn !== undefined) {
        const session = active.turn
        const snap = turnSnapOf(config, "turn", keys.only ?? [], keys.off)
        const turned = turnLanding({
          free: turn.angle,
          from: session.from,
          on: session.on !== undefined && snap.targets.includes(session.on.from) ? session.on : undefined,
          stops: turnStopsFrom(session.stops, snap.targets),
          reach: session.reach,
          nudge: session.nudge,
          hold: keys.hold,
          step: snap.step ? config.rotationStep : undefined
        })
        session.from = turn.angle
        session.on = turned.on
        showSnap(turned.on ?? {}, snap.targets)
        const rotation = quatFromAxisAngle(turn.axis, turned.angle)
        const frame = localFrameOf(active.start)
        return (frame === undefined
          ? { kind: "rotate", rotation }
          : { kind: "rotate", rotation, frame }) satisfies GroupDelta
      }
      const scale = scaleOf(active.start, now)
      if (scale === undefined) return undefined
      const snap = turnSnapOf(config, "scale", keys.only ?? [], keys.off)
      const scaled = snappedScale({
        from: active.scaleFrom,
        free: active.scaleFrom * scale.factor,
        step: snap.step ? config.scaleStep : undefined,
        face: snap.targets.includes("mesh") && scale.axis !== undefined && active.scaleFrom !== 0 && active.reach > 0
          ? { reach: active.reach / active.scaleFrom, range: active.rangeCm }
          : undefined,
        stops: active.stops
      })
      showSnap(scaled, snap.targets)
      return { ...scale, kind: "scale", factor: scaled.factor } satisfies GroupDelta
    }

    const applySample = (active: ActiveDrag, e: { readonly clientX: number; readonly clientY: number }) => {
      const delta = deltaAt(active, e)
      if (delta === undefined) return
      if (active.duplicate === "pending") {
        // The copies start where the selection is; the selection itself stays put.
        const copies = useEditor.getState().beginDuplicateDrag()
        active.duplicate = copies === undefined ? undefined : "copied"
        if (copies !== undefined) {
          active.startTransforms = byCopy(copies, active.startTransforms)
          active.selection = selectionUnits(useEditor.getState(), (id) => active.startTransforms.get(id)) ??
            active.selection
        }
      }
      const next = fitTransforms(
        useEditor.getState(),
        applyDelta(active.selection, active.pivotMode, active.startTransforms, delta)
      )
      active.last = next
      applyToObjects(next)
      previewMove(next, delta)
    }

    /** Commits what the drag came to. */
    const land = (active: ActiveDrag) => {
      const options = active.move?.commitOptions(active.startTransforms.size) ??
        turnCommitOptions(active.turn?.on, active.startTransforms.size)
      if (active.duplicate === "copied") {
        // the copy and the move are one undo entry; refused, the copies go
        useEditor.getState().endDuplicateDrag(active.last ?? null, options)
        return
      }
      if (active.last === undefined) return
      useEditor.getState().setFlipOffer(flipOfferOf(active.move?.current, [...active.startTransforms.keys()]))
      // One undo entry for the whole selection. If the document refuses it, the scene objects
      // go back where they started.
      if (!transformSelection(active.last, options)) applyToObjects(active.startTransforms)
    }

    const onPointerUp = (e: PointerEvent) => {
      const active = drag.current
      if (active === null) return
      e.stopImmediatePropagation()
      endDrag()
      // the drag is over first, so the capture this lets go of doesn't cancel it
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      land(active)
      // a click on a handle isn't a drag: what was acquired for the drag to come stays
      if (active.last !== undefined) useEditor.getState().clearTracked()
    }

    /** The pointer gone from under a drag (the system took it, or the capture was lost): it goes back, as on Escape. */
    const onPointerLost = (e: PointerEvent) => {
      const active = drag.current
      if (active === null || active.pointerId !== e.pointerId) return
      applyToObjects(active.startTransforms)
      cancelDrag(active)
    }

    /** A key changing with the pointer still takes effect at once. */
    const afterKey = (active: ActiveDrag) => {
      if (active.lastEvent !== undefined) applySample(active, active.lastEvent)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const active = drag.current
      if (active === null) return
      releaseDragKey(active.keys, e.code)
      afterKey(active)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const active = drag.current
      if (active === null) return
      if (handleDragKey(active.keys, active.move, e, useEditor.getState().keybinds)) {
        afterKey(active)
        return
      }
      if (e.code !== "Escape" && !useEditor.getState().keybinds.deselect.includes(chordOf(e))) return
      e.preventDefault()
      e.stopImmediatePropagation() // don't also deselect
      applyToObjects(active.startTransforms)
      cancelDrag(active)
    }

    el.addEventListener("pointerdown", onPointerDown, { capture: true })
    el.addEventListener("pointermove", onPointerMove)
    el.addEventListener("pointerup", onPointerUp, { capture: true })
    el.addEventListener("pointercancel", onPointerLost)
    el.addEventListener("lostpointercapture", onPointerLost)
    window.addEventListener("keydown", onKeyDown, { capture: true })
    window.addEventListener("keyup", onKeyUp, { capture: true })
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true })
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerup", onPointerUp, { capture: true })
      el.removeEventListener("pointercancel", onPointerLost)
      el.removeEventListener("lostpointercapture", onPointerLost)
      window.removeEventListener("keydown", onKeyDown, { capture: true })
      window.removeEventListener("keyup", onKeyUp, { capture: true })
      const active = drag.current
      if (active !== null) cancelDrag(active)
      hovered.current = null
    }
  }, [gizmo, gl])

  return gizmo === null ? null : <primitive object={gizmo} />
}
