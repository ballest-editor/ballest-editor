import type { PrefabInfo, PrefabTier } from "@ballest/contracts"
import { IconBoxMultiple, IconMapPlus } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { counted } from "../domain/groupSelection"
import { PREFAB_TIER_HINTS, prefabTierLabel } from "../domain/prefab"
import { openPrefab, startNewMap, startNewPrefab } from "../editor/actions"
import { useEditor } from "../editor/store"
import { useNow } from "../editor/useNow"
import { HeroBand } from "./HeroBand"
import { PathName } from "./PathText"
import { EmptySection, PrefabThumbnail } from "./PrefabsPanel"
import { MapRow } from "./ProjectPanel"
import { SectionTitle } from "./SectionTitle"
import { START_CARD } from "./startCard"

const EmptyRow = ({ line }: { readonly line: string }) => (
  <li>
    <EmptySection line={line} />
  </li>
)

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

/** A tier's prefabs, under its name. */
function PrefabTierCard({ tier }: { readonly tier: PrefabTier }) {
  const prefabs = useEditor((s) => s.prefabs).filter((prefab) => prefab.tier === tier)
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <Tooltip>
        <TooltipTrigger render={<div className="w-fit" />}>
          <SectionTitle>{prefabTierLabel(tier, true)} prefabs</SectionTitle>
        </TooltipTrigger>
        <TooltipContent side="right">{PREFAB_TIER_HINTS[tier]}</TooltipContent>
      </Tooltip>
      <ul className={cn("flex flex-col gap-0.5 p-1", START_CARD)}>
        {prefabs.length > 0
          ? prefabs.map((prefab) => <PrefabEntry key={prefab.name} prefab={prefab} />)
          : <EmptyRow line="No prefabs yet." />}
      </ul>
    </section>
  )
}

/**
 * What the centre group shows with no tab open (docs/DESKTOP.md § Document tabs): the project's maps and prefabs, laid out
 * like the start screen. Only a named project gets here, so it has a name and a folder.
 */
export function ProjectOverview() {
  const project = useEditor((s) => s.project?.current ?? null)
  const maps = useEditor((s) => s.projectMaps)
  const projectPrefabs = useEditor((s) => s.prefabs).filter((prefab) => prefab.tier === "project")
  const now = useNow()
  return (
    <div className="absolute inset-0 flex @container flex-col overflow-y-auto bg-background bg-linear-to-b from-primary/6 to-transparent to-60% p-4 text-foreground">
      {/* `m-auto`, not `justify-center`: a list too long for the group scrolls from its top, where centring would clip it */}
      <div className="m-auto grid w-full max-w-4xl grid-cols-1 gap-x-8 gap-y-6 @2xl:grid-cols-[minmax(0,1fr)_18rem]">
        {/* the track runs under the buttons in a narrow group, so it waits for the room the start screen always has */}
        <HeroBand className={cn("p-6 @2xl:col-span-2 [&>svg]:hidden @2xl:[&>svg]:block", START_CARD)}>
          <PathName name={project?.name ?? ""} path={project?.path ?? null} className="block w-fit text-title" />
          <p className="text-fg-secondary">
            {counted(maps.length, "map")} · {counted(projectPrefabs.length, "prefab")}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={() => void startNewMap()}>
              <IconMapPlus data-icon="inline-start" />
              New map
            </Button>
            <Button variant="outline" onClick={() => void startNewPrefab()}>
              <IconBoxMultiple data-icon="inline-start" />
              New prefab
            </Button>
          </div>
        </HeroBand>
        <section className="flex min-w-0 flex-col gap-2">
          <SectionTitle>Maps</SectionTitle>
          <ul className={cn("flex flex-col gap-0.5 p-1", START_CARD)}>
            {maps.length > 0
              ? maps.map((map) => <MapRow key={map.fileName} map={map} now={now} />)
              : <EmptyRow line="No maps yet." />}
          </ul>
        </section>
        <div className="flex min-w-0 flex-col gap-6">
          <PrefabTierCard tier="project" />
          <PrefabTierCard tier="user" />
        </div>
      </div>
    </div>
  )
}
