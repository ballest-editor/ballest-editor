/**
 * One move under snapping, from a gizmo handle or an item's body (docs/SNAPPING.md § What a drag looks like). It holds
 * what the drag started from, and turns each pointer sample and the keys held into the delta to apply and what to show.
 * The same session measures a turn's and a scale's targets, for the Rotate and Scale rows of Affect.
 */
import type { WorldEnd } from "../../domain/connectors"
import { defaultSpotOf, SPOT_NAMES } from "../../domain/connectorSpots"
import type { Quat4, UeTransform, Vec3 } from "../../domain/coords"
import type { GroupDelta } from "../../domain/groupTransform"
import type { Box } from "../../domain/itemBounds"
import type { Keybinds } from "../../domain/Keybinds"
import type { EndRef } from "../../domain/MapSidecar"
import {
  kindsFor,
  narrowedTo,
  priorityOf,
  rangeOf,
  type SnapConfig,
  type SnapKind,
  type SnapTarget
} from "../../domain/snapConfig"
import {
  type Constraint,
  freeOffset,
  freePoint,
  type Ray,
  type ScreenPoint,
  type SnapFrame,
  type SnapHit,
  type SnapItem,
  type SnapView
} from "../../domain/snapFrame"
import { gridAxes } from "../../domain/snapGrid"
import { shownMarks } from "../../domain/snapRelation"
import { baseNearPointer, moveOf, resolveDrag, resolveSnap } from "../../domain/snapResolve"
import type { SnappedAs, TurnStop } from "../../domain/snapRotate"
import { nearEndsOf } from "../../domain/snapTargets"
import { selectionBases } from "../../domain/snapTools"
import { annotationsOf } from "../../domain/structure"
import type { PaneCamera } from "../paneCameras"
import {
  type DragSnap,
  type EditorState,
  type FlipOffer,
  snapConfigOf,
  type SnapFeedback,
  type TransformOptions,
  useEditor
} from "../store"
import { heldKindsOf } from "./dragKeys"
import { snapMarks } from "./snapMarks"
import { snapCasts, snapItemsOf } from "./snapScene"
import { snapViewOf } from "./snapView"

/** The keys that change a drag while it is held, by what they do. */
export interface DragKeys {
  /** Inverts snapping. */
  readonly invert: boolean
  /** Holds the current target. */
  readonly hold: boolean
  /** The kinds snapping is narrowed to while their keys are held; none narrows nothing. */
  readonly only?: ReadonlyArray<SnapKind> | undefined
}

/** The move's own lock: an axis, or the plane square to one. */
export interface MoveLock {
  readonly axis: "x" | "y" | "z"
  readonly plane: boolean
}

export interface MoveStart {
  readonly pane: PaneCamera
  /** The items that move. */
  readonly keys: ReadonlySet<string>
  /** The active unit's pivot, where the gizmo sits, and the box and ends of what leads the move, as the drag starts. */
  readonly pivot: Vec3
  readonly box: Box
  readonly ends: ReadonlyArray<WorldEnd>
  readonly rotation: Quat4
  /** The gizmo's local axes, for a handle that follows them: each unit takes the move along its own in Each. */
  readonly frame?: Quat4 | undefined
  /** What the handle allows; a drag by the body slides on a surface. */
  readonly constraint: Constraint
  /** Whole grid steps along these, for a handle on the item's own axes. */
  readonly stepAxes?: ReadonlyArray<Vec3> | undefined
  /** The pointer at the start. */
  readonly ray: Ray
  readonly px: ScreenPoint
}

const LOCK_INDEX = { x: 0, y: 1, z: 2 } as const

/** The grid's axis a lock means, which is the world's until the grid is turned. */
const lockConstraint = (config: SnapConfig, { axis, plane }: MoveLock): Constraint => {
  const direction = gridAxes(config)[LOCK_INDEX[axis]]
  return plane ? { kind: "plane", normal: direction } : { kind: "line", direction }
}

const plural = (n: number) => n === 1 ? "1 item" : `${n} items`

/** How far round the selection's ends, as a share of Connectors' range, the overlay rings the ends it could join. */
const NEAR_ENDS_SHARE = 6

/** What a frame snaps to, for the overlay: its targets, and with Connectors among them the ends near the selection's. */
const dragSnapOf = (frame: SnapFrame, snapping: boolean): DragSnap => {
  const targets = snapping ? priorityOf(frame.config) : []
  const reach = rangeOf(frame.config, "connectors") * NEAR_ENDS_SHARE
  return {
    targets,
    nearEnds: targets.includes("connectors") ? nearEndsOf(frame, reach).map(({ ref }) => ref) : []
  }
}

const lowered = (label: string) => label.slice(0, 1).toLowerCase() + label.slice(1)

export interface MoveResult {
  /** The delta to apply; undefined while the pointer can't say. */
  readonly delta: GroupDelta | undefined
  readonly hit: SnapHit | undefined
}

export class MoveSession {
  private readonly view: SnapView
  private readonly items: ReadonlyArray<SnapItem>
  private readonly casts: ReturnType<typeof snapCasts>
  /** Where the pointer sat off the pivot at the start, in pixels. */
  private readonly grab: ScreenPoint
  private readonly config: SnapConfig
  private lastOffset: Vec3 = { x: 0, y: 0, z: 0 }
  /** A lock changed what the pointer means: the next sample starts a path of its own. */
  private pathBroken = false
  private held: SnapHit | undefined
  private lastHit: SnapHit | undefined
  lock: MoveLock | undefined

  private readonly start: MoveStart

  constructor(start: MoveStart, s: EditorState = useEditor.getState()) {
    this.start = start
    this.config = snapConfigOf(s)
    this.view = snapViewOf(start.pane)
    this.items = snapItemsOf(s, start.keys, this.config.targets.mesh.sharpAngle)
    this.casts = snapCasts(this.items, start.pane, this.view)
    const shown = this.view.project(start.pivot) ?? start.px
    this.grab = { x: start.px.x - shown.x, y: start.px.y - shown.y }
  }

  /** The constraint under the lock, if one is set. */
  private get constraint(): Constraint {
    return this.lock === undefined ? this.start.constraint : lockConstraint(this.config, this.lock)
  }

  /** Toggles a lock: pressing the same key again unlocks, and the move goes back to the handle's constraint. */
  toggleLock(lock: MoveLock): void {
    const same = this.lock?.axis === lock.axis && this.lock.plane === lock.plane
    this.lock = same ? undefined : lock
    this.held = undefined
    this.lastHit = undefined
    this.pathBroken = true
  }

  /** `config`, the session's under the keys held. */
  private frame(ray: Ray, px: ScreenPoint, config: SnapConfig): SnapFrame {
    const { constraint, start } = this
    const offset = freeOffset(constraint, start.pivot, start.ray, ray) ?? this.lastOffset
    this.lastOffset = offset
    const moved = this.view.project({
      x: start.pivot.x + offset.x,
      y: start.pivot.y + offset.y,
      z: start.pivot.z + offset.z
    })
    const slip = moved === undefined
      ? { x: 0, y: 0 }
      : { x: px.x - moved.x - this.grab.x, y: px.y - moved.y - this.grab.y }
    const s = useEditor.getState()
    const { construction, measurements } = annotationsOf(s.doc.structure)
    const stepAxes = this.lock === undefined ? start.stepAxes : undefined
    return {
      config,
      view: this.view,
      items: this.items,
      constraint,
      pointer: px,
      offset,
      slip,
      bases: selectionBases(config, start, constraint),
      box: start.box,
      rotation: start.rotation,
      units: s.settings.general.units,
      tracked: s.tracked.filter(({ on }) => on === undefined || !start.keys.has(on.item)),
      construction,
      measurements,
      ...(stepAxes !== undefined && { stepAxes }),
      surfaceAt: this.casts.surfaceAt,
      occluded: this.casts.occluded
    }
  }

  /** The delta for the pointer at `ray`, with `keys` held. */
  update(ray: Ray, px: ScreenPoint, keys: DragKeys): MoveResult {
    const before = this.lastOffset
    const config = narrowedTo(this.config, kindsFor("move", keys.only ?? []))
    const frame = this.frame(ray, px, config)
    const from = this.pathBroken ? frame.offset : before
    this.pathBroken = false
    const snapping = config.enabled !== keys.invert
    // Combined with Ctrl, the held target still holds. What Shift finds current is the last sample's, as this one may
    // have left it.
    const holding = keys.hold ? this.held ?? this.lastHit : undefined
    const hit = holding !== undefined
      ? resolveSnap(frame, holding)
      : snapping
      ? resolveDrag(frame, { from, current: this.lastHit })
      : undefined
    this.held = keys.hold ? holding ?? hit : undefined
    this.lastHit = hit
    const base = snapping ? baseNearPointer(frame) : undefined
    publish(hit, base === undefined ? undefined : freePoint(frame, base))
    setDragSnap(dragSnapOf(frame, snapping))
    return { delta: hit === undefined ? this.moveBy(frame.offset) : this.landingOn(hit), hit }
  }

  private landingOn(hit: SnapHit): GroupDelta {
    const { about, offset, rotation } = moveOf(hit)
    return rotation === undefined ? this.moveBy(offset) : { kind: "rigid", rotation, about, offset }
  }

  /** A move by `offset`, along the gizmo's local axes unless a lock has put it on the grid's. */
  private moveBy(offset: Vec3): GroupDelta {
    const { frame } = this.start
    return frame === undefined || this.lock !== undefined
      ? { kind: "translate", offset }
      : { kind: "translate", offset, frame }
  }

  /** How the move commits: what it joined, and what the history calls it. */
  commitOptions(count: number): TransformOptions {
    const hit = this.lastHit
    if (hit === undefined) return {}
    const delta = this.landingOn(hit)
    return {
      connected: hit.meeting !== undefined,
      description: `Move ${plural(count)} to ${lowered(hit.label)}`,
      ...(delta.kind === "rigid" && { landing: delta })
    }
  }

  /** The hit the move ended on. */
  get current(): SnapHit | undefined {
    return this.lastHit
  }
}

/** How a turn that ended on `stop` commits: what the history calls it, "Turn 1 item flush with Track L". */
export const turnCommitOptions = (stop: TurnStop | undefined, count: number): TransformOptions =>
  stop === undefined
    ? {}
    : { description: `Turn ${plural(count)} ${stop.kind === "end" ? "to " : ""}${lowered(stop.label)}` }

/** Shows a drag's live transforms, and says when `delta` is a landing, which a Point pivot follows. */
export const previewMove = (next: ReadonlyMap<string, UeTransform>, delta: GroupDelta): void =>
  useEditor.getState().setPreview(next, delta.kind === "rigid" ? delta : undefined)

/**
 * Which spot of its end a joining item meets by, and where that is chosen: the label's hint on a join. A hold key would
 * be wrong for it, as the choice stays with the item, so the Inspector is the one place to change it.
 */
export const joinHintOf = (
  s: Pick<EditorState, "doc" | "catalogIndex">,
  { end, item: key }: EndRef
): string | undefined => {
  const item = s.doc.map.items[s.doc.ids.indexOf(key)]
  const connector = item === undefined ? undefined : s.catalogIndex?.pieceByClass.get(item.actorToSpawn)
    ?.connectors?.[end]
  if (connector?.cap === undefined) return undefined
  const spot = s.doc.structure.items.get(key)?.connectAt?.[String(end)] ?? defaultSpotOf(connector)
  return spot === undefined ? undefined : `By its ${SPOT_NAMES[spot].toLowerCase()} · Inspector › Connects at`
}

/** What the label says of `hit`, and its glyph: undefined for no snap. */
export const feedbackOf = (hit: SnapHit | undefined, base = hit?.base.label): SnapFeedback | null => {
  if (hit === undefined) return null
  const warning = hit.meeting?.warning
  const hint = hit.meeting === undefined ? undefined : joinHintOf(useEditor.getState(), hit.meeting.own)
  return {
    label: hit.label,
    base: base ?? "",
    relation: hit.relation,
    ...(warning !== undefined && { warning }),
    ...(hint !== undefined && { hint })
  }
}

/** Sets the label's words, when they changed. */
export const setFeedback = (next: SnapFeedback | null): void => {
  const s = useEditor.getState()
  const now = s.snapFeedback
  const same = now?.label === next?.label && now?.base === next?.base && now?.relation === next?.relation &&
    now?.warning === next?.warning && now?.hint === next?.hint
  if (!same) s.setSnapFeedback(next)
}

/**
 * Shows a hit: both sides of it and its glyph in the scene, its words in the pane's corner and the status bar. With
 * nothing to land on, the base is drawn where it stands.
 */
const publish = (hit: SnapHit | undefined, free: Vec3 | undefined) => {
  snapMarks.set(hit === undefined ? [] : shownMarks(hit), hit === undefined ? free : undefined)
  setFeedback(feedbackOf(hit))
}

/** What a move that ended on `hit` leaves in the chip: the mirrored twin, when that's what would fit. */
export const flipOfferOf = (hit: SnapHit | undefined, keys: ReadonlyArray<string>): FlipOffer | null => {
  const meeting = hit?.meeting
  return meeting?.flipFits === true ? { keys, axis: "y", own: meeting.own, other: meeting.other } : null
}

/** Sets what the drag snaps to, when it changed. */
const setDragSnap = (next: DragSnap | null): void => {
  const s = useEditor.getState()
  const now = s.dragSnap
  const sameRefs = (a: DragSnap["nearEnds"], b: DragSnap["nearEnds"]) =>
    a.length === b.length && a.every((ref, i) => {
      const other = b[i]
      return other !== undefined && ref.item === other.item && ref.end === other.end
    })
  const same = now === next || (now !== null && next !== null &&
    now.targets.length === next.targets.length && now.targets.every((target, i) => target === next.targets[i]) &&
    sameRefs(now.nearEnds, next.nearEnds))
  if (!same) s.setDragSnap(next)
}

/** Hides what a drag showed, its keys in the status bar among it, when it ends. */
export const endSnapDisplay = (): void => {
  snapMarks.clear()
  useEditor.getState().setSnapFeedback(null)
  useEditor.getState().setDragKeys(null)
  setDragSnap(null)
}

/** Which of `keybinds`' drag keys are down, of the codes `pressed`. */
export const dragKeysOf = (keybinds: Keybinds, pressed: ReadonlySet<string>): DragKeys => ({
  invert: keybinds.snapInvert.some((code) => pressed.has(code)),
  hold: keybinds.snapHold.some((code) => pressed.has(code)),
  only: heldKindsOf(keybinds, pressed)
})

/** Shown for a rotate or scale snap, as a move's are, with the `targets` the turn or scale stops on. */
export const showSnap = ({ label, marks = [], relation }: SnappedAs, targets: ReadonlyArray<SnapTarget>): void => {
  snapMarks.set(marks, undefined)
  setFeedback(label === undefined ? null : { label, base: "Pivot", ...(relation !== undefined && { relation }) })
  setDragSnap({ targets, nearEnds: [] })
}
