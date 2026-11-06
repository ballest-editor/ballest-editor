import { prefabFileNameOf } from "@ballest/contracts"
import { IconFolderOpen } from "@tabler/icons-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { prefabTierLabel } from "../domain/prefab"
import { revealPrefabs } from "../editor/actions"
import { type PrefabDocument, useEditor } from "../editor/store"
import { PathAction } from "./PathText"
import { SectionTitle } from "./SectionTitle"

/** The file's name, the whole path in its tooltip; a deleted definition has no path, so only the name. */
function FileName({ name, path }: { readonly name: string; readonly path: string | null }) {
  return path === null ? <span className="min-w-0 truncate">{name}</span> : (
    <Tooltip>
      <TooltipTrigger render={<span className="min-w-0 truncate" />}>{name}</TooltipTrigger>
      <TooltipContent side="bottom" className="break-all">{path}</TooltipContent>
    </Tooltip>
  )
}

/** A definition's tab with nothing selected: what it is. Its name and where it is stored change in the Prefabs panel. */
export function PrefabSettings({ prefab }: { readonly prefab: PrefabDocument }) {
  const itemCount = useEditor((s) => s.doc.map.items.length)
  const path = useEditor((s) => s.file?.path ?? null)
  const projects = useEditor((s) => s.capabilities.projects)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col">
        <SectionTitle>Prefab</SectionTitle>
        <span className="truncate text-body-strong">{prefab.name}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-body">
        <dt className="text-fg-secondary">Stored in</dt>
        <dd>{prefabTierLabel(prefab.tier, projects)}</dd>
        <dt className="text-fg-secondary">Items</dt>
        <dd>{itemCount}</dd>
        <dt className="text-fg-secondary">File</dt>
        <dd className="flex min-w-0 items-center justify-between gap-1">
          <FileName name={prefabFileNameOf(prefab.name)} path={path} />
          {projects && path !== null && (
            <PathAction
              label="Reveal in file manager"
              icon={IconFolderOpen}
              onClick={() => void revealPrefabs(prefab.tier)}
            />
          )}
        </dd>
      </dl>
    </div>
  )
}
