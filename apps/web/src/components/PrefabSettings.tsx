import { prefabFileNameOf } from "@ballest/contracts"
import { IconFolderOpen } from "@tabler/icons-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { mapLabelOf } from "../domain/factory"
import { prefabTierLabel } from "../domain/prefab"
import { openProjectMap, projectMapsUsingPrefab, revealPrefabs, tabsUsingPrefab } from "../editor/actions"
import { type PrefabDocument, tabWithFile, useEditor, useTabSummary } from "../editor/store"
import { PathAction } from "./PathText"
import { SectionTitle } from "./SectionTitle"
import { TextLink } from "./TextLink"

/** The file's name, the whole path in its tooltip; a deleted definition has no path, so only the name. */
function FileName({ name, path }: { readonly name: string; readonly path: string | null }) {
  return path === null ? <span className="min-w-0 truncate">{name}</span> : (
    <Tooltip>
      <TooltipTrigger render={<span className="min-w-0 truncate" />}>{name}</TooltipTrigger>
      <TooltipContent side="bottom" className="break-all">{path}</TooltipContent>
    </Tooltip>
  )
}

function OpenMapLink({ tabId }: { readonly tabId: string }) {
  const { label } = useTabSummary(tabId)
  const activateTab = useEditor((s) => s.activateTab)
  return <TextLink onClick={() => activateTab(tabId)}>{label}</TextLink>
}

/**
 * The maps that hold instances of the definition, each a link to its tab: the open ones as they stand now, unsaved edits
 * and all, then the project's other maps as their sidecars say. A map not in this project can't be seen from here.
 */
function UsedIn({ prefab: { name, tier } }: { readonly prefab: PrefabDocument }) {
  const open = useEditor(useShallow((s) => tabsUsingPrefab(s, { tier, name })))
  const maps = useEditor((s) => s.projectMaps)
  const [onDisk, setOnDisk] = useState<ReadonlyArray<string>>([])
  useEffect(() => {
    let cancelled = false
    void projectMapsUsingPrefab({ tier, name }, maps).then((fileNames) => {
      if (!cancelled) setOnDisk(fileNames)
    })
    return () => {
      cancelled = true
    }
  }, [tier, name, maps])
  const closed = useEditor(useShallow((s) => onDisk.filter((fileName) => tabWithFile(s, fileName) === undefined)))
  if (open.length === 0 && closed.length === 0) return <span className="text-fg-tertiary">No maps</span>
  return (
    <div className="flex min-w-0 flex-col items-start">
      {open.map((tabId) => <OpenMapLink key={tabId} tabId={tabId} />)}
      {closed.map((fileName) => (
        <TextLink key={fileName} onClick={() => void openProjectMap(fileName)}>
          {mapLabelOf(fileName)}
        </TextLink>
      ))}
    </div>
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
        <dt className="self-start text-fg-secondary">Used in</dt>
        <dd className="min-w-0">
          <UsedIn prefab={prefab} />
        </dd>
      </dl>
    </div>
  )
}
