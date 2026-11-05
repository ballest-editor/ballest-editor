import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useState } from "react"
import type { GroupNode } from "../domain/MapSidecar"
import { treeKeys } from "../domain/structure"
import { useEditor } from "../editor/store"
import { SectionTitle } from "./SectionTitle"
import { TagInput } from "./TagInput"

/** A selection that is exactly one group: its name and tags. */
export function GroupSection({ group }: { readonly group: GroupNode }) {
  const renameGroup = useEditor((s) => s.renameGroup)
  const setTags = useEditor((s) => s.setTags)
  // An edit in progress; otherwise the input shows the group's name.
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null) renameGroup(group.id, draft)
    setDraft(null)
  }
  const count = treeKeys([group]).length
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>Group of {count} item{count === 1 ? "" : "s"}</SectionTitle>
      <div className="flex flex-col gap-1">
        <Label htmlFor="group-name" className="text-muted-foreground">Name</Label>
        <Input
          id="group-name"
          value={draft ?? group.name}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            if (e.key === "Escape") setDraft(null)
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="group-tags" className="text-muted-foreground">Tags</Label>
        <TagInput id="group-tags" tags={group.tags} onChange={(tags) => setTags(group.id, tags)} />
      </div>
    </div>
  )
}

/** A single selected item's tags. */
export function ItemTags({ itemKey }: { readonly itemKey: string }) {
  const tags = useEditor((s) => s.doc.structure.items.get(itemKey)?.tags)
  const setTags = useEditor((s) => s.setTags)
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="item-tags" className="text-muted-foreground">Tags</Label>
      <TagInput id="item-tags" tags={tags ?? []} onChange={(next) => setTags(itemKey, next)} />
    </div>
  )
}
