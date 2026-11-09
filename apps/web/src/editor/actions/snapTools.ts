/**
 * Snapping's settings and the tools built on the targets (docs/SNAPPING.md § Tools built on the targets). A tool asks the
 * one target picker for its points and faces, and does its work here as one undo step.
 */
import { Effect, Equal } from "effect"
import { endsOf, meetingTurn } from "../../domain/connectors"
import type { SpotId } from "../../domain/connectorSpots"
import type { Quat4, UeTransform, Vec3 } from "../../domain/coords"
import { editTransform } from "../../domain/editTransform"
import { applyGroupDelta, type RigidDelta } from "../../domain/groupTransform"
import { type Box, itemsBoxOf } from "../../domain/itemBounds"
import { withFlip } from "../../domain/itemProperties"
import { connectedKeys } from "../../domain/joints"
import type { Item } from "../../domain/MapFile"
import { prefabSnapKeyOf } from "../../domain/MapPrefs"
import type { Construction, EndRef } from "../../domain/MapSidecar"
import { withMirrorMesh } from "../../domain/mirror"
import {
  defaultSnapConfig,
  isPreset,
  SNAP_PRESETS,
  type SnapConfig,
  type SnapPreset,
  type SnapTarget
} from "../../domain/snapConfig"
import {
  angleBetweenFaces,
  type ArrangeMarks,
  arrangeMarks,
  arrangeOffsets,
  type ArrangeOp,
  axisFromPoints,
  axisFromWorld,
  type BoxAxis,
  type BoxSide,
  type Distribution,
  type FaceMeeting,
  faceMeeting,
  measurementFacts,
  mirroredTransform,
  type MirrorPlane,
  movesBox,
  planeFromFace,
  planeFromOffset,
  planeFromPoints,
  planeFromWorld,
  type WORLD_AXES,
  WORLD_NORMALS,
  type WorldPlane
} from "../../domain/snapTools"
import { annotationsOf, freshKey } from "../../domain/structure"
import { IDENTITY_QUAT, ORIGIN, rotateVec, vecDot, vecSub } from "../../domain/ueMath"
import {
  applyDelta,
  applyUnitOffsets,
  carriedKeys,
  pivotModeFor,
  type SelectionUnits,
  type Unit
} from "../../domain/units"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { activePaneCamera } from "../paneCameras"
import { snapMarks } from "../snap/snapMarks"
import {
  editedKeys,
  type EditorState,
  fitTransforms,
  type PickedTarget,
  type PickerRequest,
  selectionPivot,
  selectionUnits,
  shownTransform,
  snapConfigOf,
  useEditor
} from "../store"
import { run } from "./run"
import { saveSettings } from "./startup"

/** Gives the open tab `config`: a map's are saved with it, a definition's go in the editor's own prefs. */
const applySnap = (config: SnapConfig) => {
  const s = useEditor.getState()
  s.setTabSnap(config)
  if (s.document.kind !== "prefab") return
  const key = prefabSnapKeyOf(s.document)
  void run(
    Effect.flatMap(Effect.service(MapPrefsStore), (store) => store.save(key, { snap: config })).pipe(
      Effect.catch((error) => Effect.logWarning("Couldn't keep the definition's snap settings", error))
    )
  )
}

/** Changes the tab's snap settings. */
export const updateSnap = (patch: Partial<SnapConfig>) => applySnap({ ...snapConfigOf(useEditor.getState()), ...patch })

/** Changes one target's parameters. */
export const updateSnapTarget = <T extends SnapTarget>(target: T, patch: Partial<SnapConfig["targets"][T]>) => {
  const config = snapConfigOf(useEditor.getState())
  applySnap({ ...config, targets: { ...config.targets, [target]: { ...config.targets[target], ...patch } } })
}

/** Turns snapping as a whole on or off: the magnet, and what Ctrl inverts during a drag. */
export const toggleSnapping = () => updateSnap({ enabled: !snapConfigOf(useEditor.getState()).enabled })

/** Picks the grid's step, and turns the Grid target on to use it: snapping as a whole keeps its own say. */
export const pickGridSize = (gridSize: number) => {
  const config = snapConfigOf(useEditor.getState())
  applySnap({ ...config, gridSize, targets: { ...config.targets, grid: { ...config.targets.grid, enabled: true } } })
}

/** Turns several targets on or off together, as the snap menu's Guides row does. */
export const setSnapTargets = (targets: ReadonlyArray<SnapTarget>, enabled: boolean) => {
  const config = snapConfigOf(useEditor.getState())
  const turned = Object.fromEntries(targets.map((target) => [target, { ...config.targets[target], enabled }]))
  applySnap({ ...config, targets: { ...config.targets, ...turned } })
}

/** The snap menu's Prefer: which wins when both are near, the grid or pieces and their ends. */
export type SnapPreference = "grid" | "pieces"

const PREFERENCE_PRESETS: Readonly<Record<SnapPreference, SnapPreset>> = { grid: "gridFirst", pieces: "piecesFirst" }

/** Which Prefer `config` is: a preset's order with the ends' pull even. Null for anything else, a custom priority. */
export const snapPreferenceOf = (config: SnapConfig): SnapPreference | null => {
  if (config.targets.connectors.weight !== 1) return null
  return isPreset(config, "gridFirst") ? "grid" : isPreset(config, "piecesFirst") ? "pieces" : null
}

/** Sets Prefer: the preset's order, and the ends' pull back to even, so the order alone decides. */
export const preferSnap = (preference: SnapPreference) => {
  const config = snapConfigOf(useEditor.getState())
  applySnap({
    ...config,
    order: SNAP_PRESETS[PREFERENCE_PRESETS[preference]],
    targets: { ...config.targets, connectors: { ...config.targets.connectors, weight: 1 } }
  })
}

/** Whether the tab's snap settings are what new maps start on. */
export const snapIsDefault = (s: EditorState): boolean => Equal.equals(snapConfigOf(s), s.settings.snapping)

/** Makes the tab's snap settings, all of them, what new maps start on (docs/SNAPPING.md § Settings). */
export const saveSnapDefaults = () => {
  const s = useEditor.getState()
  return saveSettings({ ...s.settings, snapping: snapConfigOf(s) })
}

/** Gives the tab the snap settings new maps start on. */
export const resetSnapToDefaults = () => applySnap(useEditor.getState().settings.snapping)

/** Whether what new maps start on is the factory's. */
export const snapDefaultsAreFactory = (s: Pick<EditorState, "settings">): boolean =>
  Equal.equals(s.settings.snapping, defaultSnapConfig)

/**
 * Puts what new maps start on back to the factory's (Settings › Editor › Snapping). A map with snapping of its own keeps
 * it, and the user's snapping stays as it is.
 */
export const resetSnapDefaults = () => saveSettings({ ...useEditor.getState().settings, snapping: defaultSnapConfig })

/** The items a tool that moves "B" moves: the selection if the pick is on it, else the item picked. */
const movingKeys = (s: EditorState, item: string | undefined): ReadonlyArray<string> =>
  item === undefined ? [] : s.selectedIds.includes(item) ? s.selectedIds : [item]

const editTransformOf = (s: EditorState, key: string): UeTransform | undefined => {
  const item = s.doc.map.items[s.doc.ids.indexOf(key)]
  return item === undefined ? undefined : editTransform(item)
}

/** The document's transforms of `keys`. */
const editTransformsOf = (s: EditorState, keys: ReadonlyArray<string>) =>
  new Map(keys.flatMap((key) => {
    const t = editTransformOf(s, key)
    return t === undefined ? [] : [[key, t] as const]
  }))

/** The item `key`s through `delta`, and when they are the selection, the links it carries inside an entered chain. */
const movedBy = (s: EditorState, keys: ReadonlyArray<string>, delta: RigidDelta) => {
  const selection = keys === s.selectedIds ? selectionUnits(s, (key) => editTransformOf(s, key)) : undefined
  const start = editTransformsOf(s, selection === undefined ? keys : editedKeys(s))
  return selection === undefined
    ? new Map([...start].map(([key, t]) => [key, applyGroupDelta(t, t.translation, delta)] as const))
    : applyDelta(selection, pivotModeFor(s, selection), start, delta)
}

/** `delta` on the items `keys`, as one undo step called `description`. */
const moveKeys = (
  keys: ReadonlyArray<string>,
  delta: RigidDelta,
  description: string,
  connected = false
) => {
  const s = useEditor.getState()
  s.transformItems(fitTransforms(s, movedBy(s, keys, delta)), { description, connected, landing: delta })
}

const pick = (request: PickerRequest) => useEditor.getState().setPicker(request)

/** Puts picks `b`'s face on `a`'s, or joins two ends. */
const meet = (a: PickedTarget, b: PickedTarget) => {
  const s = useEditor.getState()
  const keys = movingKeys(s, b.item)
  const { flushMode: mode, flushOffset } = s
  if (a.end !== undefined && b.end !== undefined) {
    moveKeys(
      keys,
      {
        kind: "rigid",
        rotation: meetingTurn(b.end, a.end),
        about: b.point,
        offset: vecSub(a.point, b.point)
      },
      `Join ${b.label} to ${a.label}`,
      true
    )
    return
  }
  if (a.normal === undefined || b.normal === undefined) return
  const move = faceMeeting(
    { point: a.point, normal: a.normal },
    { point: b.point, normal: b.normal },
    mode,
    flushOffset
  )
  moveKeys(keys, { kind: "rigid", ...move }, `${mode === "flush" ? "Flush" : "Tangent"} to ${a.label}`)
}

/** Flush and tangent: a face on A, a face on B, and B moves. With Connectors on, two ends join. */
export const startFlush = () =>
  pick({
    prompt: "Click a face on the piece that stays.",
    accepts: "faceOrEnd",
    panel: "flush",
    onPick: (a) =>
      pick({
        prompt: "Click a face on the piece to move.",
        accepts: "faceOrEnd",
        panel: "flush",
        onPick: (b) => meet(a, b)
      })
  })

export const setFlushOptions = (options: { readonly mode?: FaceMeeting; readonly offset?: number }) =>
  useEditor.setState((s) => ({ flushMode: options.mode ?? s.flushMode, flushOffset: options.offset ?? s.flushOffset }))

const itemsOf = (s: EditorState, keys: ReadonlyArray<string>) =>
  keys.flatMap((key) => s.doc.map.items[s.doc.ids.indexOf(key)] ?? [])

/** A unit of the selection and the box around all of it. */
interface UnitBox {
  readonly unit: Unit
  readonly box: Box
}

/** The selection as units, each with its box where the document has one, square to `frame`'s axes and in its terms. */
const selectedBoxes = (s: EditorState, frame?: Quat4) => {
  const selection = selectionUnits(s, (key) => editTransformOf(s, key))
  const boxes = (selection?.units ?? []).flatMap((unit): ReadonlyArray<UnitBox> => {
    const box = itemsBoxOf(itemsOf(s, unit.keys), s.catalogIndex, frame)
    return box === undefined ? [] : [{ unit, box }]
  })
  return { selection, boxes }
}

/** Moves each of `boxes`' units whole by its offset, as one undo step. */
const offsetUnits = (
  selection: SelectionUnits,
  boxes: ReadonlyArray<UnitBox>,
  offsets: ReadonlyArray<Vec3>,
  description: (count: number) => string
) => {
  const s = useEditor.getState()
  const byUnit = new Map(boxes.map(({ unit }, i) => [unit.id, offsets[i] ?? ORIGIN] as const))
  const moved = applyUnitOffsets(
    selection,
    editTransformsOf(s, editedKeys(s)),
    (unit) => byUnit.get(unit.id) ?? ORIGIN
  )
  s.transformItems(fitTransforms(s, moved), { description: description(moved.size) })
}

/**
 * The axes Align and Distribute work along: the world's, or with the gizmo in Local the active unit's, as a move's
 * axis handle would run (docs/SNAPPING.md § Align and distribute).
 */
const arrangeFrameOf = (s: EditorState, active: Unit): Quat4 =>
  s.gizmoSpace === "local" ? active.transform.rotation : IDENTITY_QUAT

/** What one Align or Distribute does to the selection, which its preview draws and its button runs. */
export interface ArrangePlan {
  readonly selection: SelectionUnits
  readonly boxes: ReadonlyArray<UnitBox>
  /** How far each of `boxes` moves, in the world. */
  readonly offsets: ReadonlyArray<Vec3>
  /** How many units move: none when the selection already stands as `op` would put it. */
  readonly moving: number
  /** What the preview draws: in the world, but for its landings, which are boxes in `frame`'s terms. */
  readonly marks: ArrangeMarks
  /** The axes the boxes are square to: turn a landing's corners by it to put them in the world. */
  readonly frame: Quat4
  /** The world's direction of `op`'s axis. */
  readonly direction: Vec3
}

const UNIT_AXES = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } } as const

/** `op` on the selection as it stands; undefined unless two or more units are selected. */
export const arrangePlanOf = (s: EditorState, op: ArrangeOp): ArrangePlan | undefined => {
  const first = selectedBoxes(s)
  if (first.selection === undefined || first.selection.units.length < 2) return undefined
  const frame = arrangeFrameOf(s, first.selection.active)
  const { boxes, selection } = frame === IDENTITY_QUAT ? first : selectedBoxes(s, frame)
  if (selection === undefined || boxes.length < 2) return undefined
  const active = boxes.findIndex(({ unit }) => unit.id === selection.active.id)
  const own = arrangeOffsets(boxes.map(({ box }) => box), op, Math.max(active, 0), s.arrangeSpacing ?? undefined)
  const toWorld = (v: Vec3) => rotateVec(frame, v)
  const points = (list: ReadonlyArray<Vec3>) => list.map(toWorld)
  const marks = arrangeMarks(boxes.map(({ box }) => box), own, op, Math.max(active, 0))
  return {
    selection,
    boxes,
    offsets: own.map(toWorld),
    moving: own.filter(movesBox).length,
    marks: {
      // a landing stays a box in the frame's terms: the overlay turns its corners
      landings: marks.landings,
      faces: marks.faces.map(({ from, to }) => ({ from: points(from), to: points(to) })),
      ...(marks.reference !== undefined && { reference: points(marks.reference) }),
      ...(marks.plane !== undefined && { plane: points(marks.plane) }),
      paths: marks.paths.map(({ from, to }) => ({ from: toWorld(from), to: toWorld(to) })),
      dimensions: marks.dimensions.map(({ cm, from, to }) => ({ cm, from: toWorld(from), to: toWorld(to) }))
    },
    frame,
    direction: toWorld(UNIT_AXES[op.axis])
  }
}

const describeArrange = (op: ArrangeOp, count: number) => {
  const axis = op.axis.toUpperCase()
  const items = `${count} item${count === 1 ? "" : "s"}`
  return op.kind === "align" ? `Align ${items} on ${axis}` : `Distribute ${items} along ${axis}`
}

/** Runs `op` on the selection as one undo step; nothing when it would move nothing. */
export const arrangeSelection = (op: ArrangeOp) => {
  const plan = arrangePlanOf(useEditor.getState(), op)
  if (plan === undefined || plan.moving === 0) return
  offsetUnits(plan.selection, plan.boxes, plan.offsets, (count) => describeArrange(op, count))
}

/** Lines the selection's `side` up on `axis`: on the active unit, or on the box around them all. */
export const alignSelection = (axis: BoxAxis, side: BoxSide, to: "active" | "bounds") =>
  arrangeSelection({ kind: "align", axis, side, to })

export const distributeSelection = (axis: BoxAxis, by: Distribution) =>
  arrangeSelection({ kind: "distribute", axis, by })

/** Which Align button the panes preview, or none. */
export const setArrangeHover = (op: ArrangeOp | null) => useEditor.setState({ arrangeHover: op })

/** Distribute's spacing: a number of cm out from the active unit, or null for Auto. */
export const setArrangeSpacing = (spacing: number | null) => useEditor.setState({ arrangeSpacing: spacing })

export type ScreenDirection = "left" | "right" | "up" | "down"

/**
 * The Align that lines the selection up on the active unit's side facing `direction` on screen in the active pane: the
 * frame's axis that runs most nearly that way, and its end that way (docs/SNAPPING.md § Align and distribute).
 */
export const screenAlignOf = (s: EditorState, direction: ScreenDirection): ArrangeOp => {
  const { right, up } = activePaneCamera().screenAxes()
  const toward = direction === "left" || direction === "right" ? right : up
  const sign = direction === "left" || direction === "down" ? -1 : 1
  const selection = selectionUnits(s, (key) => editTransformOf(s, key))
  const frame = selection === undefined ? IDENTITY_QUAT : arrangeFrameOf(s, selection.active)
  const reach = (axis: BoxAxis) => sign * vecDot(rotateVec(frame, UNIT_AXES[axis]), toward)
  const [best] = (["x", "y", "z"] as const).toSorted((a, b) => Math.abs(reach(b)) - Math.abs(reach(a)))
  const axis = best ?? "x"
  return { kind: "align", axis, side: reach(axis) > 0 ? "max" : "min", to: "active" }
}

/** The Align `direction` on screen means in the active pane as it is now. */
export const screenAlignNow = (direction: ScreenDirection): ArrangeOp => screenAlignOf(useEditor.getState(), direction)

/** Ctrl+Shift+an arrow: lines the selection up on the active unit's side that way on screen. */
export const alignToScreen = (direction: ScreenDirection) =>
  arrangeSelection(screenAlignOf(useEditor.getState(), direction))

const round = (value: number) => Math.round(value * 10) / 10

/** Two clicks on any target; two faces give their angle. The measurement stays until cleared, as a target itself. */
export const startMeasure = () =>
  pick({
    prompt: "Click where the measurement starts.",
    accepts: "any",
    onPick: (a) =>
      pick({
        prompt: "Click where it ends.",
        accepts: "any",
        onPick: (b) => {
          const s = useEditor.getState()
          const angle = a.end === undefined && b.end === undefined && a.normal !== undefined && b.normal !== undefined
            ? angleBetweenFaces(a.normal, b.normal)
            : undefined
          const { delta, distance } = measurementFacts(a.point, b.point)
          s.addMeasurement({ id: freshKey(), a: a.point, b: b.point, ...(angle !== undefined && { angle }) })
          s.notify("info", angle === undefined ? `${round(distance)} cm` : `${round(angle)}°`, {
            kind: "measurement",
            body: `X ${round(delta.x)}, Y ${round(delta.y)}, Z ${round(delta.z)} cm`
          })
        }
      })
  })

export const clearMeasurements = () => useEditor.getState().clearMeasurements()

/**
 * Reflects the selection in `plane`, as one undo step: every unit, and the links it carries inside an entered chain, item
 * by item, so what they make up comes out as its mirror image. Items that can't flip in the game only move, and it says so.
 */
export const mirrorSelection = (plane: MirrorPlane) => {
  const s = useEditor.getState()
  const selection = selectionUnits(s, (key) => shownTransform(s, key))
  if (selection === undefined) return
  const placed = carriedKeys(selection).flatMap((key) => {
    const item = s.doc.map.items[s.doc.ids.indexOf(key)]
    const t = shownTransform(s, key)
    return item === undefined || t === undefined ? [] : [{ key, item, t }]
  })
  const flippable = placed.filter(({ item }) => {
    const piece = s.catalogIndex?.pieceByClass.get(item.actorToSpawn)
    return withFlip({ item, piece }, "x") !== item
  })
  if (placed.length === 0) return
  const moved = new Map(placed.map(({ key, t }) => [key, mirroredTransform(t, plane)] as const))
  s.mirrorItems(moved, new Set(flippable.map(({ key }) => key)), "x", {
    description: `Mirror ${placed.length} items`,
    reflection: plane
  })
  const rigid = placed.length - flippable.length
  if (rigid > 0) {
    s.notify("info", `${rigid} of ${placed.length} pieces can't flip in the game, so they only moved across.`, {
      kind: "mirrorRigid"
    })
  }
}

/** Mirror: the plane comes from the target picker. */
export const startMirror = () =>
  pick({
    prompt: "Click a face or construction plane to mirror across.",
    accepts: "face",
    onPick: ({ normal, point }) => {
      if (normal !== undefined) mirrorSelection({ origin: point, normal })
    }
  })

/** Mirror across a world plane through the grid's origin. */
export const mirrorAcrossWorld = (plane: WorldPlane) => {
  const { origin } = snapConfigOf(useEditor.getState()).targets.grid
  mirrorSelection({ origin, normal: WORLD_NORMALS[plane] })
}

/** The active unit's pivot and yaw: where the gizmo sits and which way it faces. */
const activePivotOf = (s: EditorState) => selectionPivot(s, (id) => shownTransform(s, id))

export const startGridOriginPick = () =>
  pick({
    prompt: "Click the grid's new origin.",
    accepts: "any",
    onPick: ({ point }) => updateSnapTarget("grid", { origin: point })
  })

export const gridOriginToWorld = () => updateSnapTarget("grid", { origin: ORIGIN })

export const gridOriginToSelection = () => {
  const target = activePivotOf(useEditor.getState())
  if (target !== undefined) updateSnapTarget("grid", { origin: target.pivot })
}

/** The selection's yaw in degrees. */
const yawOf = (rotation: UeTransform["rotation"]) => {
  const forward = rotateVec(rotation, { x: 1, y: 0, z: 0 })
  return Math.atan2(forward.y, forward.x) * 180 / Math.PI
}

export const gridYawToSelection = () => {
  const target = activePivotOf(useEditor.getState())
  if (target !== undefined) updateSnapTarget("grid", { yaw: yawOf(target.rotation) })
}

export const gridYawReset = () => updateSnapTarget("grid", { yaw: 0 })

/** Selects everything joints reach from the selection: the whole track. */
export const selectConnected = () => {
  const s = useEditor.getState()
  const reached = connectedKeys(annotationsOf(s.doc.structure).joints, s.selectedIds)
  s.select([...s.selectedIds, ...s.doc.ids.filter((key) => reached.has(key) && !s.selectedIds.includes(key))])
}

/** An end of the map, with its item as `item` would stand there. */
const endOf = (s: EditorState, { end, item: key }: EndRef, item?: Item) => {
  const index = s.doc.ids.indexOf(key)
  const of = item ?? s.doc.map.items[index]
  const placed = s.doc.map.items[index]
  return of === undefined || placed === undefined
    ? undefined
    : endsOf(key, of, editTransform(placed), s.catalogIndex, s.doc.structure.items.get(key)?.connectAt)[end]
}

/**
 * Takes up the chip's offer of the mirrored twin, as one undo step. A flip goes through the item's origin, which carries
 * an end off the axis away from the one it joined, so the selection lands on that end again.
 */
export const applyFlipOffer = () => {
  const s = useEditor.getState()
  const offer = s.flipOffer
  s.setFlipOffer(null)
  if (offer === null) return
  const source = s.doc.map.items[s.doc.ids.indexOf(offer.own.item)]
  const piece = source === undefined ? undefined : s.catalogIndex?.pieceByClass.get(source.actorToSpawn)
  const flipped = source === undefined
    ? undefined
    : withMirrorMesh(withFlip({ item: source, piece }, offer.axis), s.catalogIndex)
  const own = flipped === undefined ? undefined : endOf(s, offer.own, flipped)
  const other = endOf(s, offer.other)
  if (own === undefined || other === undefined) return
  const delta: RigidDelta = {
    kind: "rigid",
    rotation: meetingTurn(own, other),
    about: own.position,
    offset: vecSub(other.position, own.position)
  }
  const moved = new Map(offer.keys.flatMap((key) => {
    const t = editTransformOf(s, key)
    return t === undefined ? [] : [[key, applyGroupDelta(t, t.translation, delta)] as const]
  }))
  s.mirrorItems(fitTransforms(s, moved), new Set([offer.own.item]), offer.axis, {
    description: "Flip to fit",
    connected: true,
    landing: delta
  })
}

const nextName = (kind: "Plane" | "Axis") => {
  const taken = annotationsOf(useEditor.getState().doc.structure).construction
  const count = taken.filter((one) => one.kind === (kind === "Plane" ? "plane" : "axis")).length
  return `${kind} ${count + 1}`
}

const addConstruction = (construction: Construction | undefined) => {
  const s = useEditor.getState()
  if (construction === undefined) s.notify("info", "Those points don't make one: pick points apart from each other.")
  else s.addConstruction(construction)
}

export const startPlaneFromFace = () =>
  pick({
    prompt: "Click a face to make a plane from.",
    accepts: "face",
    onPick: ({ normal, point }) => {
      if (normal !== undefined) addConstruction(planeFromFace(point, normal, freshKey(), nextName("Plane")))
    }
  })

export const startPlaneFromPoints = () =>
  pick({
    prompt: "Click the plane's first point.",
    accepts: "any",
    onPick: (a) =>
      pick({
        prompt: "Click its second point.",
        accepts: "any",
        onPick: (b) =>
          pick({
            prompt: "Click its third point.",
            accepts: "any",
            onPick: (c) => addConstruction(planeFromPoints(a.point, b.point, c.point, freshKey(), nextName("Plane")))
          })
      })
  })

export const addWorldPlane = (plane: WorldPlane) => {
  const { origin } = snapConfigOf(useEditor.getState()).targets.grid
  addConstruction(planeFromWorld(plane, origin, freshKey(), nextName("Plane")))
}

export const addOffsetPlane = (id: string, distance: number, angle: number) => {
  const from = annotationsOf(useEditor.getState().doc.structure).construction.find((one) => one.id === id)
  if (from?.kind === "plane") addConstruction(planeFromOffset(from, distance, angle, freshKey(), nextName("Plane")))
}

export const addWorldAxis = (axis: (typeof WORLD_AXES)[number]) => {
  const { origin } = snapConfigOf(useEditor.getState()).targets.grid
  addConstruction(axisFromWorld(axis, origin, freshKey(), nextName("Axis")))
}

export const startAxisFromPoints = () =>
  pick({
    prompt: "Click a point on the axis.",
    accepts: "any",
    onPick: (a) =>
      pick({
        prompt: "Click a second point on it.",
        accepts: "any",
        onPick: (b) => addConstruction(axisFromPoints(a.point, b.point, freshKey(), nextName("Axis")))
      })
  })

/**
 * Rings, in the source's colour, where end `end` of the item `key` would connect at `spot`, as the snap overlay rings a
 * landing end: what the Inspector's Connects at shows while one of its spots is hovered. Null takes the ring away.
 */
export const showConnectSpot = (key: string, end: number, spot: SpotId | null) => {
  if (spot === null) {
    snapMarks.clear()
    return
  }
  const s = useEditor.getState()
  const item = s.doc.map.items[s.doc.ids.indexOf(key)]
  const transform = shownTransform(s, key)
  const at = item === undefined || transform === undefined
    ? undefined
    : endsOf(key, item, transform, s.catalogIndex, { [String(end)]: spot })[end]?.position
  snapMarks.set(at === undefined ? [] : [{ kind: "ring", role: "source", at }], undefined)
}
