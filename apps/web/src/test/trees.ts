/** Group trees for the selection rules' tests. */
import type { TreeNode } from "../domain/MapSidecar"

export const item = (key: string): TreeNode => ({ kind: "item", key })

export const group = (id: string, ...children: ReadonlyArray<TreeNode>): TreeNode => ({
  kind: "group",
  id,
  name: id,
  tags: [],
  children
})

/** outer > (inner > (a, b), c); d loose; solo > only > e */
export const nestedTree: ReadonlyArray<TreeNode> = [
  group("outer", group("inner", item("a"), item("b")), item("c")),
  item("d"),
  group("solo", group("only", item("e")))
]
