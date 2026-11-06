import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { type ReactNode, useMemo, useState } from "react"
import type { UeTransform } from "../domain/coords"
import { formatBoxSize, placedBoxOf } from "../domain/itemBounds"
import type { Item } from "../domain/MapFile"
import type { GroupNode, PrefabLink } from "../domain/MapSidecar"
import { isSamePrefab } from "../domain/prefab"
import { checkInstance } from "../domain/prefabInstance"
import { detachInstance, openPrefab, updateInstance } from "../editor/actions"
import { useEditor } from "../editor/store"
import { SectionHeader, SectionTitle } from "./SectionTitle"
import { TagInput } from "./TagInput"

/** How many items a group holds and how much room they take, as shown (live during a drag), and Frame. */
function GroupCard({ items, transforms }: {
  readonly items: ReadonlyArray<Item>
  readonly transforms: ReadonlyArray<UeTransform>
}) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const requestFocus = useEditor((s) => s.requestFocus)
  const box = useMemo(
    () =>
      placedBoxOf(
        items.flatMap((item, i) => {
          const transform = transforms[i]
          return transform === undefined ? [] : [{ item, transform }]
        }),
        catalogIndex
      ),
    [items, transforms, catalogIndex]
  )
  const count = `${items.length.toLocaleString()} item${items.length === 1 ? "" : "s"}`
  return (
    <div className="flex items-center justify-between gap-2 rounded-surface bg-muted/40 py-1 pr-1 pl-3 ring-edge not-dark:ring-1">
      <span className="min-w-0 text-body">{box === undefined ? count : `${count} · ${formatBoxSize(box)}`}</span>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={requestFocus}>Frame</Button>
    </div>
  )
}

/** A selection that is exactly one group: its card, its name and tags, then the summary it's given. */
export function GroupSection({ group, items, transforms, actions, children }: {
  readonly group: GroupNode
  /** The group's items, with their transforms as shown. */
  readonly items: ReadonlyArray<Item>
  readonly transforms: ReadonlyArray<UeTransform>
  /** The selection's icon buttons, at the section's header. */
  readonly actions: ReactNode
  readonly children: ReactNode
}) {
  const renameGroup = useEditor((s) => s.renameGroup)
  const setTags = useEditor((s) => s.setTags)
  // An edit in progress; otherwise the input shows the group's name.
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null) renameGroup(group.id, draft)
    setDraft(null)
  }
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader title="Group">{actions}</SectionHeader>
      <GroupCard items={items} transforms={transforms} />
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
      {children}
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
      <SectionTitle>
        Instance of <span className="tracking-normal normal-case">{link.name}</span>
      </SectionTitle>
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
