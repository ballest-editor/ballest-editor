import { IconFileImport, IconPlus } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { mapLabelOf } from "../domain/factory"
import { linkStateOf } from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import { importMap, openProjectMap, startNewMap } from "../editor/actions"
import { type ProjectMap, useEditor } from "../editor/store"
import { useNow } from "../editor/useNow"
import { GameLink } from "./GameLink"
import { LinkStateBadge } from "./LinkStateBadge"

function MapRow({ map, now }: { readonly map: ProjectMap; readonly now: number }) {
  const isOpen = useEditor((s) => s.mapOpen && s.file?.name === map.fileName)
  const dirty = useEditor((s) => s.dirty)
  return (
    <li>
      <button
        type="button"
        title={map.path}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_10rem_8rem] items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted",
          isOpen && "bg-muted/60"
        )}
        onClick={() => openProjectMap(map.fileName)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{mapLabelOf(map.fileName)}</span>
          {isOpen && <span className="shrink-0 text-muted-foreground">open</span>}
        </span>
        <LinkStateBadge state={linkStateOf(map, { unsaved: isOpen && dirty })} />
        <span className="text-right text-muted-foreground" title={formatDateTime(map.modifiedAt)}>
          edited {formatAgo(map.modifiedAt, now)}
        </span>
      </button>
    </li>
  )
}

/** Desktop: the project's maps, most recently changed first, with their link state. */
function ProjectMaps() {
  const maps = useEditor((s) => s.projectMaps)
  const now = useNow()
  if (maps.length === 0) {
    return (
      <p className="px-3 py-6 text-muted-foreground">
        No maps yet. New map starts one here; Import… copies one in from the game's maps folder or anywhere else.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-0.5">{maps.map((map) => <MapRow key={map.fileName} map={map} now={now} />)}</ul>
  )
}

/**
 * The Start tab (docs/PROJECTS.md § Shell), shown when no map is open and from View › Start. On desktop: the maps in
 * the project, New map, Import… and the Game link. In a browser, which has no project: New map and Open….
 */
export function StartTab() {
  const projects = useEditor((s) => s.capabilities.projects)
  const projectName = useEditor((s) => s.project?.current.name ?? null)

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background text-xs">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <section aria-labelledby="start-maps" className="flex flex-col gap-2">
          <header className="flex items-center gap-2 px-3">
            <h2 id="start-maps" className="flex-1 text-sm font-medium">
              {projects ? `Maps in ${projectName ?? "this project"}` : "Start"}
            </h2>
            <Button variant="outline" onClick={() => void importMap()}>
              <IconFileImport data-icon="inline-start" />
              {projects ? "Import…" : "Open…"}
            </Button>
            <Button onClick={() => void startNewMap()}>
              <IconPlus data-icon="inline-start" />
              New map
            </Button>
          </header>
          {projects
            ? <ProjectMaps />
            : (
              <p className="px-3 py-6 text-muted-foreground">
                This browser build keeps one map in memory and downloads it to save. The desktop app keeps your maps in
                a project folder and exports them to the game.
              </p>
            )}
        </section>
        {projects && <GameLink />}
      </div>
    </div>
  )
}
