import type { PrefabInfo, PrefabTier } from "@ballest/contracts"
import { IconBoxMultiple, IconDownload, IconMapPlus, IconSettings } from "@tabler/icons-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { counted } from "../domain/groupSelection"
import type { KeybindAction } from "../domain/Keybinds"
import { PREFAB_TIER_HINTS, prefabTierLabel } from "../domain/prefab"
import { importMap, openPrefab, startNewMap, startNewPrefab } from "../editor/actions"
import { useEditor } from "../editor/store"
import { useNow } from "../editor/useNow"
import { HeroBand } from "./HeroBand"
import { PathName } from "./PathText"
import { PrefabThumbnail } from "./PrefabsPanel"
import { MapRow } from "./ProjectPanel"
import { SectionTitle } from "./SectionTitle"
import { START_CARD } from "./startCard"
import { CappedList, StartAction, StartList, StartSection } from "./startLists"

/** One prefab: a click opens its definition, where the Prefabs panel's click places it, as no map is open to place it in. */
function PrefabEntry({ prefab }: { readonly prefab: PrefabInfo }) {
  const { itemCount, name, path, tier } = prefab
  const readable = itemCount !== null
  return (
    <li>
      <button
        type="button"
        disabled={!readable}
        title={readable ? path ?? name : "Can't be read as a prefab"}
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left transition-colors focus-ring enabled:hover:bg-hover enabled:active:bg-pressed disabled:text-fg-disabled"
        onClick={() => void openPrefab({ tier, name })}
      >
        <PrefabThumbnail prefab={prefab} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className={cn("shrink-0 text-caption", readable ? "text-fg-tertiary" : "text-fg-disabled")}>
          {readable ? counted(itemCount, "item") : "Unreadable"}
        </span>
      </button>
    </li>
  )
}

/** A tier's prefabs, under its name, the hint on hover. */
function PrefabTierList({ tier }: { readonly tier: PrefabTier }) {
  const prefabs = useEditor((s) => s.prefabs).filter((prefab) => prefab.tier === tier)
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <Tooltip>
        <TooltipTrigger render={<div className="w-fit" />}>
          <SectionTitle>{prefabTierLabel(tier, true)} prefabs</SectionTitle>
        </TooltipTrigger>
        <TooltipContent side="right">{PREFAB_TIER_HINTS[tier]}</TooltipContent>
      </Tooltip>
      <CappedList
        rows={prefabs.map((prefab) => <PrefabEntry key={prefab.name} prefab={prefab} />)}
        empty={<p className="text-fg-tertiary">No prefabs yet.</p>}
      />
    </section>
  )
}

/** The project's first key for `action`, for a start action's chip. */
const useBinding = (action: KeybindAction) => useEditor((s) => s.keybinds[action][0])

/**
 * The project's welcome page (docs/DESKTOP.md § Document tabs), after VS Code's: what the centre group shows with no
 * tab open, which is how a project opens when it was left with no map open, and what closing its last map leaves. Start
 * has the ways in, each with its key, and Recent the maps most recently edited; the prefabs are on the right. Only a
 * named project gets here, so it has a name and a folder.
 */
export function ProjectOverview() {
  const project = useEditor((s) => s.project?.current ?? null)
  const maps = useEditor((s) => s.projectMaps)
  const projectPrefabs = useEditor((s) => s.prefabs).filter((prefab) => prefab.tier === "project")
  const newMapKey = useBinding("newMap")
  const importKey = useBinding("openMap")
  const now = useNow()
  return (
    <div className="absolute inset-0 flex @container flex-col overflow-y-auto bg-background bg-linear-to-b from-primary/6 to-transparent to-60% p-6 text-foreground">
      {/* `m-auto`, not `justify-center`: a list too long for the group scrolls from its top, where centring would clip it */}
      <div className="m-auto grid w-full max-w-4xl grid-cols-1 gap-x-12 gap-y-8 @2xl:grid-cols-[minmax(0,1fr)_18rem]">
        {/* the track runs under the text in a narrow group, so it waits for the room the start screen always has */}
        <HeroBand className={cn("p-5 @2xl:col-span-2 [&>svg]:hidden @2xl:[&>svg]:block", START_CARD)}>
          <PathName name={project?.name ?? ""} path={project?.path ?? null} className="block w-fit text-title" />
          <p className="text-fg-secondary">
            {counted(maps.length, "map")} · {counted(projectPrefabs.length, "prefab")}
          </p>
        </HeroBand>
        <div className="flex min-w-0 flex-col gap-8">
          <StartSection title="Start">
            <StartList>
              <StartAction
                icon={<IconMapPlus />}
                label="New map"
                binding={newMapKey}
                onClick={() => void startNewMap()}
              />
              <StartAction icon={<IconBoxMultiple />} label="New prefab" onClick={() => void startNewPrefab()} />
              <StartAction
                icon={<IconDownload />}
                label="Import map…"
                binding={importKey}
                onClick={() => void importMap()}
              />
              <StartAction
                icon={<IconSettings />}
                label="Project settings…"
                onClick={() => useEditor.getState().openDialog({ id: "projectSettings" })}
              />
            </StartList>
          </StartSection>
          <StartSection title="Recent">
            <CappedList
              rows={maps.map((map) => <MapRow key={map.fileName} map={map} now={now} />)}
              empty={<p className="text-fg-tertiary">No maps yet. New map starts one.</p>}
            />
          </StartSection>
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <PrefabTierList tier="project" />
          <PrefabTierList tier="user" />
        </div>
      </div>
    </div>
  )
}
