/**
 * Schema of a map's sidecar, `maps/<file name>.editor.json`: what the game's format can't hold. The game never reads it.
 * docs/PROJECTS.md § The files has the shape and its rules.
 */
import { FileHash, PrefabName, PrefabTier } from "@ballest/contracts"
import { Schema } from "effect"

/** An item's stable key or a group's id: random and URL-safe. The two share one space, so a tree node has one id. */
const NodeId = Schema.String.check(Schema.isPattern(/^[\w-]{1,64}$/))

export const Tags = Schema.Array(Schema.String)

export class SidecarItem extends Schema.Opaque<SidecarItem>()(
  Schema.Struct({
    /** The item's place in the `.balledit` the sidecar was written for. */
    index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    /** Finds the item again in a `.balledit` that changed (`fingerprintOf`). */
    fingerprint: Schema.String,
    name: Schema.optionalKey(Schema.String),
    tags: Schema.optionalKey(Tags)
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

/**
 * How much more each link of a chain turns than the one before when it bends (docs/DESKTOP.md § Group pivots and
 * chains): `linear` adds `percent` of the first link's turn per link, so the curve tightens steadily (a clothoid);
 * `compound` multiplies by `1 + percent / 100` per link, so it tightens faster and faster. Absent, every link turns
 * alike.
 */
export const ChainGrowth = Schema.Struct({
  curve: Schema.Literals(["linear", "compound"]),
  percent: Schema.Finite
})
export type ChainGrowth = typeof ChainGrowth.Type

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
  /** A chain's growth; absent on a plain group. */
  readonly growth?: ChainGrowth
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
    chain: Schema.optionalKey(Schema.Literal(true)),
    growth: Schema.optionalKey(ChainGrowth)
  })
])

export class MapSidecar extends Schema.Opaque<MapSidecar>()(
  Schema.Struct({
    formatVersion: Schema.Literal(1),
    /** SHA-256 of the `.balledit` bytes this sidecar was written for. */
    mapHash: FileHash,
    /** Per item, by stable key. */
    items: Schema.Record(NodeId, SidecarItem),
    /** Groups and items as the outline shows them; groups nest to any depth, every item is in one place. */
    tree: Schema.Array(TreeNode)
  })
) {}
