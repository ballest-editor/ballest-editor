/**
 * Schema of a map's sidecar, `maps/<file name>.editor.json`: what the game's format can't hold. The game never reads it.
 * docs/PROJECTS.md § The files has the shape and its rules.
 */
import { FileHash } from "@ballest/contracts"
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
}

export type TreeNode = ItemNode | GroupNode

const ItemNodeSchema = Schema.Struct({ kind: Schema.Literal("item"), key: NodeId })

const GroupNodeSchema = Schema.Struct({
  kind: Schema.Literal("group"),
  id: NodeId,
  name: Schema.String,
  tags: Tags,
  children: Schema.Array(Schema.suspend((): Schema.Codec<TreeNode> => TreeNode))
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
