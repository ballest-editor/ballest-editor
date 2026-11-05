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
}

export type TreeNode = ItemNode | GroupNode

const ItemNodeSchema = Schema.Struct({ kind: Schema.Literal("item"), key: NodeId })

const GroupNodeSchema = Schema.Struct({
  kind: Schema.Literal("group"),
  id: NodeId,
  name: Schema.String,
  tags: Tags,
  children: Schema.Array(Schema.suspend((): Schema.Codec<TreeNode> => TreeNode)),
  prefab: Schema.optionalKey(PrefabLink)
})

const TreeNode: Schema.Codec<TreeNode> = Schema.Union([ItemNodeSchema, GroupNodeSchema])

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
