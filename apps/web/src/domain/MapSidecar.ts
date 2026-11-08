/**
 * Schema of a map's sidecar, `maps/<file name>.editor.json`: what the game's format can't hold. The game never reads it.
 * docs/PROJECTS.md § The files has the shape and its rules.
 */
import { FileHash, PrefabName, PrefabTier } from "@ballest/contracts"
import { Schema } from "effect"
import { SPOT_IDS } from "./connectorSpots"
import { SnapConfig } from "./snapConfig"

/** An item's stable key or a group's id: random and URL-safe. The two share one space, so a tree node has one id. */
const NodeId = Schema.String.check(Schema.isPattern(/^[\w-]{1,64}$/))

export const Tags = Schema.Array(Schema.String)

/** Where an item's ends connect, by end index, for those not at their measured point (docs/SNAPPING.md § Connectors). */
const ConnectAt = Schema.Record(Schema.String.check(Schema.isPattern(/^\d{1,3}$/)), Schema.Literals(SPOT_IDS))

export class SidecarItem extends Schema.Opaque<SidecarItem>()(
  Schema.Struct({
    /** The item's place in the `.balledit` the sidecar was written for. */
    index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    /** Finds the item again in a `.balledit` that changed (`fingerprintOf`). */
    fingerprint: Schema.String,
    name: Schema.optionalKey(Schema.String),
    tags: Schema.optionalKey(Tags),
    connectAt: Schema.optionalKey(ConnectAt)
  })
) {}

/**
 * What makes a group a prefab instance: the definition it was placed from. `items` is what each of those items was, in
 * the definition's frame and document order (`signatureOf`), which is how an instance is told from an edited one once
 * the definition has moved on.
 */
export const PrefabLink = Schema.Struct({
  tier: PrefabTier,
  name: PrefabName,
  /** The SHA-256 of the definition's file when this was placed or last updated. */
  hash: FileHash,
  items: Schema.Array(Schema.String)
})
export type PrefabLink = typeof PrefabLink.Type

/** The faces of the box around a group's items that its pivot can sit on, named as the game names an item's. */
export const GROUP_PIVOT_FACES = ["Bottom", "Top", "Left", "Right", "Back", "Front"] as const
export type GroupPivotFace = (typeof GROUP_PIVOT_FACES)[number]

const WorldPoint = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite })

/**
 * Where a group turns and scales, and where its gizmo sits, when that isn't the centre of its items' box (the game's
 * Ctrl+G frame, and the default): a face of that box, one member's own pivot, or a world point the user froze.
 */
export const GroupPivot = Schema.Union([
  Schema.Struct({ choice: Schema.Literals(GROUP_PIVOT_FACES) }),
  Schema.Struct({ choice: Schema.Literal("item"), key: NodeId }),
  Schema.Struct({ choice: Schema.Literal("point"), world: WorldPoint })
])
export type GroupPivot = typeof GroupPivot.Type

export interface ItemNode {
  readonly kind: "item"
  readonly key: string
}

export interface GroupNode {
  readonly kind: "group"
  readonly id: string
  readonly name: string
  readonly tags: ReadonlyArray<string>
  readonly children: ReadonlyArray<TreeNode>
  readonly prefab?: PrefabLink
  readonly pivot?: GroupPivot
  /** A chain: its children, in this order, are its links, each hanging off the one before (docs/DESKTOP.md § Chains). */
  readonly chain?: true
}

export type TreeNode = ItemNode | GroupNode

const TreeNode: Schema.Codec<TreeNode> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("item"), key: NodeId }),
  Schema.Struct({
    kind: Schema.Literal("group"),
    id: NodeId,
    name: Schema.String,
    tags: Tags,
    children: Schema.Array(Schema.suspend((): Schema.Codec<TreeNode> => TreeNode)),
    prefab: Schema.optionalKey(PrefabLink),
    pivot: Schema.optionalKey(GroupPivot),
    chain: Schema.optionalKey(Schema.Literal(true))
  })
])

const Vector = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite })

/** One end of a placed piece: the item, and which of its piece's connectors. */
export const EndRef = Schema.Struct({ item: NodeId, end: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })
export type EndRef = typeof EndRef.Type

/** Two ends that met when a connector snap committed. A record, not a weld (docs/SNAPPING.md § Decisions). */
export const Joint = Schema.Struct({ a: EndRef, b: EndRef })
export type Joint = typeof Joint.Type

/** A plane of the map's own, drawn as a finite square. */
export const ConstructionPlane = Schema.Struct({
  kind: Schema.Literal("plane"),
  id: NodeId,
  name: Schema.String,
  origin: Vector,
  /** Unit length, and square to `xAxis`. */
  normal: Vector,
  xAxis: Vector,
  /** Half the drawn square's side, in cm. */
  extent: Schema.Finite,
  /** The grid's steps on the plane: a tilted grid. */
  grid: Schema.Boolean
})
export type ConstructionPlane = typeof ConstructionPlane.Type

/** An axis of the map's own, drawn as a finite line. */
export const ConstructionAxis = Schema.Struct({
  kind: Schema.Literal("axis"),
  id: NodeId,
  name: Schema.String,
  origin: Vector,
  /** Unit length. */
  direction: Vector,
  /** Half the drawn line's length, in cm. */
  extent: Schema.Finite
})
export type ConstructionAxis = typeof ConstructionAxis.Type

export const Construction = Schema.Union([ConstructionPlane, ConstructionAxis])
export type Construction = typeof Construction.Type

/** A measurement that stays until it is cleared: between two points, or the angle between two faces at `a` and `b`. */
export const Measurement = Schema.Struct({
  id: NodeId,
  a: Vector,
  b: Vector,
  /** The angle between the faces in degrees, for two faces; absent for two points. */
  angle: Schema.optionalKey(Schema.Finite)
})
export type Measurement = typeof Measurement.Type

/** What a map holds for snapping beyond its settings (docs/SNAPPING.md § What the sidecar holds). */
export const Annotations = Schema.Struct({
  joints: Schema.Array(Joint),
  construction: Schema.Array(Construction),
  measurements: Schema.Array(Measurement)
})
export type Annotations = typeof Annotations.Type

export class MapSidecar extends Schema.Opaque<MapSidecar>()(
  Schema.Struct({
    formatVersion: Schema.Literal(1),
    /** SHA-256 of the `.balledit` bytes this sidecar was written for. */
    mapHash: FileHash,
    /** Per item, by stable key. */
    items: Schema.Record(NodeId, SidecarItem),
    /** Groups and items as the outline shows them; groups nest to any depth, every item is in one place. */
    tree: Schema.Array(TreeNode),
    /** Joints, construction geometry and measurements; absent while the map has none. */
    annotations: Schema.optionalKey(Annotations),
    /** The map's snap settings, the grid's origin and turn among them; absent while it uses the defaults. */
    snap: Schema.optionalKey(SnapConfig)
  })
) {}
