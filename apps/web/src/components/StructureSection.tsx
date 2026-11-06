import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useMemo, useState } from "react"
import type { GroupNode, PrefabLink } from "../domain/MapSidecar"
import { isSamePrefab } from "../domain/prefab"
import { checkInstance } from "../domain/prefabInstance"
import { treeKeys } from "../domain/structure"
import { detachInstance, openPrefab, updateInstance } from "../editor/actions"
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
        <Label htmlFor="group-name" className="text-fg-secondary">Name</Label>
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
        <Label htmlFor="group-tags" className="text-fg-secondary">Tags</Label>
        <TagInput id="group-tags" tags={group.tags} onChange={(tags) => setTags(group.id, tags)} />
      </div>
    </div>
  )
}

const instanceStatusOf = (found: boolean, current: boolean, unmodified: boolean) => {
  if (!found) return "Its definition has gone. It keeps its items."
  if (current) return unmodified ? "It follows its definition." : "Edited here, so it no longer follows its definition."
  return unmodified ? "Its definition has changed." : "Edited here, and its definition has changed."
}

/** A selection that is exactly one prefab instance: what it is an instance of, and what can be done about it. */
export function InstanceSection({ group, link }: { readonly group: GroupNode; readonly link: PrefabLink }) {
  const doc = useEditor((s) => s.doc)
  const definition = useEditor((s) => s.prefabs.find((p) => isSamePrefab(p, link)))
  const { unmodified } = useMemo(() => checkInstance(doc, group, link), [doc, group, link])
  const found = definition !== undefined
  const current = definition?.hash === link.hash
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>Instance of {link.name}</SectionTitle>
      <p className="text-body text-fg-tertiary">{instanceStatusOf(found, current, unmodified)}</p>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={!found || (current && unmodified)}
          onClick={() => void updateInstance(group.id, link)}
        >
          Update
        </Button>
        <Button variant="outline" size="sm" onClick={() => detachInstance(group.id)}>Detach</Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!found}
          onClick={() => void openPrefab({ tier: link.tier, name: link.name })}
        >
          Open definition
        </Button>
      </div>
    </div>
  )
}

export function ItemTags({ itemKey }: { readonly itemKey: string }) {
  const tags = useEditor((s) => s.doc.structure.items.get(itemKey)?.tags)
  const setTags = useEditor((s) => s.setTags)
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="item-tags" className="text-fg-secondary">Tags</Label>
      <TagInput id="item-tags" tags={tags ?? []} onChange={(next) => setTags(itemKey, next)} />
    </div>
  )
}
