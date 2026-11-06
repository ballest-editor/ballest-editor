import { cn } from "@workspace/ui/lib/utils"
import { exactSelectedGroup } from "../domain/groupSelection"
import { isSamePrefab } from "../domain/prefab"
import { detachInstance, openPrefab } from "../editor/actions"
import { useEditor } from "../editor/store"
import { GROUP, GROUP_DIVIDER, noFocus, SEGMENT } from "./viewControlStyle"

/**
 * Over the viewport while the selection is exactly one instance, under the first pane's card (`ViewPanes`): what it is an instance of, and the two ways out of being one, so neither needs the Inspector.
 */
export function InstanceBanner() {
  const group = useEditor((s) => exactSelectedGroup(s.doc.structure.tree, s.selectedIds, s.enteredGroupId))
  const link = group?.prefab
  const found = useEditor((s) => link !== undefined && s.prefabs.some((p) => isSamePrefab(p, link)))
  if (group === undefined || link === undefined) return null
  return (
    <div
      className={cn(GROUP, "max-w-full")}
      data-instance-banner
    >
      <span className="min-w-0 truncate px-2 text-fg-secondary" title={link.name}>
        Instance of <span className="text-foreground">{link.name}</span>
      </span>
      <span aria-hidden className={GROUP_DIVIDER} />
      <button
        type="button"
        className={cn(SEGMENT, "shrink-0")}
        disabled={!found}
        onClick={() => void openPrefab({ tier: link.tier, name: link.name })}
        {...noFocus}
      >
        Open definition
      </button>
      <span aria-hidden className={GROUP_DIVIDER} />
      <button type="button" className={cn(SEGMENT, "shrink-0")} onClick={() => detachInstance(group.id)} {...noFocus}>
        Detach
      </button>
    </div>
  )
}
