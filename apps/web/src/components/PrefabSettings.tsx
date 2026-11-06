import { prefabFileNameOf } from "@ballest/contracts"
import { IconFolderOpen } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { mapLabelOf } from "../domain/factory"
import { prefabTierLabel } from "../domain/prefab"
import { openProjectMap, projectMapsUsingPrefab, revealPrefabs, tabsUsingPrefab } from "../editor/actions"
import { type PrefabDocument, tabWithFile, useEditor, useTabSummary } from "../editor/store"
import { Fact, Facts } from "./Facts"
import { PathAction, PathName } from "./PathText"
import { SectionTitle } from "./SectionTitle"
import { TextLink } from "./TextLink"

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
      <Facts>
        <Fact dense label="Stored in">{prefabTierLabel(prefab.tier, projects)}</Fact>
        <Fact dense label="Items">{itemCount}</Fact>
        <Fact dense label="File">
          {/* a deleted definition has no path */}
          <PathName name={prefabFileNameOf(prefab.name)} path={path} className="min-w-0 truncate" />
          {projects && path !== null && (
            <PathAction
              label="Reveal in folder"
              icon={IconFolderOpen}
              onClick={() => void revealPrefabs(prefab.tier)}
              className="ml-auto"
            />
          )}
        </Fact>
        <dt className="self-start text-fg-secondary">Used in</dt>
        <dd className="min-w-0">
          <UsedIn prefab={prefab} />
        </dd>
      </Facts>
    </div>
  )
}
