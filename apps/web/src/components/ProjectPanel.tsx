import { IconDots, IconDownload, IconMap, IconMapPlus, IconSettings } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@workspace/ui/components/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { mapLabelOf } from "../domain/factory"
import { linkStateDetailOf, linkStateOf, syncStatusOf } from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import {
  exportProjectMapFromPanel,
  importMap,
  loadMapThumbnail,
  nameProjectMap,
  openProjectMap,
  openProjectMapInBackground,
  openProjectMapInGameFromPanel,
  playProjectMapFromPanel,
  revealProject,
  startNewMap
} from "../editor/actions"
import { startMapDrag } from "../editor/mapDrag"
import {
  type ProjectMap,
  tabsWithoutFile,
  useEditedAt,
  useEditor,
  useHasUnsavedEdits,
  useTabSummary
} from "../editor/store"
import { useNow } from "../editor/useNow"
import { HeaderButton } from "./HeaderButton"
import { onMiddleClick } from "./middleClick"
import { NameChip } from "./NameChip"
import { PathName } from "./PathText"
import { THUMBNAIL_TILE } from "./PieceThumbnail"
import { StatusChip, SyncStatusChip } from "./SyncStatusChip"

/**
 * A row is a grid: its tile, then the name and the chip on the first line, and under them a second line as wide as both.
 * Its button is the name alone, but its `after` covers the row, so a click anywhere opens it (`ROW_BUTTON_CLASSES`);
 * what has a click or a tooltip of its own sits above that (`ROW_CHIP_CLASSES`, the ⋮ button).
 */
const ROW_CLASSES =
  "group relative grid h-10 min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] grid-rows-[1.25rem_1rem] content-center gap-x-2 rounded-control px-2 text-body transition-colors focus-ring-row hover:bg-hover active:bg-pressed"

const ROW_BUTTON_CLASSES = "min-w-0 truncate text-left outline-none after:absolute after:inset-0"

const ROW_CHIP_CLASSES = "relative z-10 self-center"

/** Past the row's second line: the name and the chip are on its first, and their tooltips open below the row. */
const ROW_TIP_OFFSET = 24

/** The map in the active tab: tinted, with a bar at its left, so it reads at a glance. */
const ACTIVE_ROW_CLASSES =
  "bg-selected text-foreground shadow-[inset_2px_0_0_0] shadow-primary hover:lift-selected active:press-selected"

/** What a row leads with: the map's top-down render, or the glyph until a Save has made one. */
function MapTile({ png }: { readonly png?: string | undefined }) {
  return (
    <span
      className={cn(
        "row-span-2 flex size-8 items-center justify-center self-center overflow-hidden rounded-control",
        THUMBNAIL_TILE
      )}
    >
      {png === undefined
        ? <IconMap className="size-4 text-fg-secondary" />
        : <img src={png} alt="" draggable={false} className="size-full" />}
    </span>
  )
}

/** A row's name, which opens it. The tooltip has what the row has no room for: the full name, and how its map stands. */
function RowName({ label, active, unsaved, edited, onClick }: {
  readonly label: string
  readonly active: boolean
  readonly unsaved: string | null
  readonly edited: string | null
  readonly onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" className={cn(ROW_BUTTON_CLASSES, active && "text-body-strong")} onClick={onClick} />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" sideOffset={ROW_TIP_OFFSET}>
        <div className="flex max-w-xs flex-col gap-0.5">
          <span className="text-body-strong">{label}</span>
          {unsaved !== null && <span className="opacity-80">{unsaved}</span>}
          {edited !== null && <span className="opacity-80">Edited {edited}</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** A row's second line: what there is to say of its file. */
function RowDetail({ children }: { readonly children: ReactNode }) {
  return <span className="col-span-2 col-start-2 row-start-2 truncate text-caption text-fg-tertiary">{children}</span>
}

/** A map's menu, the same from its ⋮ and from a right-click. Mounted only while one of them is open. */
function MapMenuItems({ fileName }: { readonly fileName: string }) {
  const isOpen = useEditor((s) => s.file?.name === fileName)
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const canPlay = useEditor((s) => s.capabilities.play)
  return (
    <>
      <DropdownMenuItem disabled={isOpen} onClick={() => void openProjectMap(fileName)}>Open</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => void nameProjectMap(fileName, "rename")}>Rename…</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void nameProjectMap(fileName, "duplicate")}>Duplicate…</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void nameProjectMap(fileName, "recover")}>Backups…</DropdownMenuItem>
      {canExport && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void exportProjectMapFromPanel(fileName)}>Export to game</DropdownMenuItem>
          {canPlay && <DropdownMenuItem onClick={() => void playProjectMapFromPanel(fileName)}>Play</DropdownMenuItem>}
          {canPlay && (
            <DropdownMenuItem onClick={() => void openProjectMapInGameFromPanel(fileName)}>
              Open in game
            </DropdownMenuItem>
          )}
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => void revealProject()}>Reveal in folder</DropdownMenuItem>
    </>
  )
}

/**
 * One of the project's maps: a click opens it, a middle click opens it behind the active tab, and a drag onto the tab
 * strip opens it there. Its menu (also on right-click) has what else can be done with it. The open map is highlighted,
 * and the chip says what it has unsaved or left to export. The tooltips open below the row, so they never cover its
 * chip or ⋮ button.
 */
export function MapRow({ map, now }: { readonly map: ProjectMap; readonly now: number }) {
  const isOpen = useEditor((s) => s.file?.name === map.fileName)
  const unsaved = useHasUnsavedEdits(map.fileName)
  const editedAt = useEditedAt(map.fileName, map.modifiedAt)
  const png = useEditor((s) => s.mapThumbnails.get(map.hash))
  const label = mapLabelOf(map.fileName)
  const state = linkStateOf(map, { unsaved })
  useEffect(() => loadMapThumbnail(map.hash), [map.hash])
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<li />}
        draggable
        className={cn(ROW_CLASSES, isOpen ? ACTIVE_ROW_CLASSES : "data-popup-open:bg-hover")}
        onDragStart={(e) => startMapDrag(e.dataTransfer, map.fileName)}
        {...onMiddleClick(() => void openProjectMapInBackground(map.fileName))}
      >
        <MapTile png={png} />
        <RowName
          label={label}
          active={isOpen}
          unsaved={unsaved ? "Unsaved edits" : null}
          edited={formatDateTime(editedAt)}
          onClick={() => void openProjectMap(map.fileName)}
        />
        <Tooltip>
          <TooltipTrigger
            render={<SyncStatusChip status={syncStatusOf(state, unsaved)} icon={false} className={ROW_CHIP_CLASSES} />}
          />
          <TooltipContent side="bottom" align="end" sideOffset={ROW_TIP_OFFSET}>
            {linkStateDetailOf(map, state, now)}
          </TooltipContent>
        </Tooltip>
        <RowDetail>Edited {formatAgo(editedAt, now)}</RowDetail>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 bottom-0 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                aria-label={`More for ${label}`}
              />
            }
          >
            <IconDots />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <MapMenuItems fileName={map.fileName} />
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MapMenuItems fileName={map.fileName} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * A tab whose map has no file yet (`tabsWithoutFile`): a row of its own, whichever tab is active, chipped Unsaved unless
 * it is blank. A click makes it the active tab.
 */
function UnsavedRow({ tabId }: { readonly tabId: string }) {
  const { label, unsaved, backup } = useTabSummary(tabId)
  const isActive = useEditor((s) => s.tabId === tabId)
  const activateTab = useEditor((s) => s.activateTab)
  return (
    <li className={cn(ROW_CLASSES, isActive && ACTIVE_ROW_CLASSES)}>
      <MapTile />
      <RowName
        label={label}
        active={isActive}
        unsaved="Not saved yet"
        edited={null}
        onClick={() => activateTab(tabId)}
      />
      {unsaved && <SyncStatusChip status="unsaved" icon={false} className={ROW_CHIP_CLASSES} />}
      {/* Under the name, not after it: beside the Unsaved chip it would cut the name at the panel's usual width. */}
      <RowDetail>
        {backup && <NameChip className="mr-1">backup</NameChip>}
        Not saved yet
      </RowDetail>
    </li>
  )
}

/** What the header calls the project: its name, with its folder on hover, or a chip while it has none. */
function ProjectName({ name, path }: { readonly name: string | null; readonly path: string | null }) {
  if (name === null) {
    return (
      <span className="flex min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger render={<StatusChip tone="neutral" />}>Untitled</TooltipTrigger>
          <TooltipContent side="bottom">Saving a map creates the project</TooltipContent>
        </Tooltip>
      </span>
    )
  }
  return <PathName name={name} path={path} className="min-w-0 flex-1 truncate text-body-strong" />
}

/**
 * The Project panel (docs/PROJECTS.md § Shell): the project and its maps, the way an editor's file explorer shows a
 * workspace. Every tab whose map has no file yet is a row too, above them. In a browser, which has no project, only
 * those rows show.
 */
export function ProjectPanel() {
  const projects = useEditor((s) => s.capabilities.projects)
  const project = useEditor((s) => s.project?.current ?? null)
  const maps = useEditor((s) => s.projectMaps)
  const unsavedTabs = useEditor(useShallow(tabsWithoutFile))
  const openDialog = useEditor((s) => s.openDialog)
  const now = useNow()
  const untitled = projects && project === null
  // nothing to list: a tab with no file is a row, so Untitled Project, which always has one, never gets here
  const empty = maps.length === 0 && unsavedTabs.length === 0
  return (
    <aside className="flex h-full min-w-0 flex-col bg-card">
      {/* the name lines up with the rows' glyphs, and the last button with their ⋮ */}
      <div className="flex h-8 shrink-0 items-center gap-1 pr-2 pl-4">
        <ProjectName name={projects ? project?.name ?? null : "This browser"} path={project?.path ?? null} />
        <HeaderButton label="New map" onClick={() => void startNewMap()}>
          <IconMapPlus />
        </HeaderButton>
        <HeaderButton
          label={!projects ? "Open…" : untitled ? "Import map: save a map first" : "Import map"}
          disabled={untitled}
          onClick={() => void importMap()}
        >
          <IconDownload />
        </HeaderButton>
        {projects && (
          <HeaderButton label="Project settings" onClick={() => openDialog({ id: "projectSettings" })}>
            <IconSettings />
          </HeaderButton>
        )}
      </div>
      <ScrollArea className={empty ? "min-h-0" : "min-h-0 flex-1"}>
        <ul className="flex flex-col gap-0.5 px-2 pb-2">
          {unsavedTabs.map((tabId) => <UnsavedRow key={tabId} tabId={tabId} />)}
          {/* the tabs above aren't in the project; a rule keeps them from reading as its first maps */}
          {unsavedTabs.length > 0 && maps.length > 0 && (
            <li role="separator" aria-orientation="horizontal" className="mx-2 my-1 border-t border-border/60" />
          )}
          {maps.map((map) => <MapRow key={map.fileName} map={map} now={now} />)}
        </ul>
      </ScrollArea>
      {empty && (
        <div className="flex flex-1 shrink-0 flex-col items-center justify-center gap-2 p-4">
          <p className="text-body text-fg-tertiary">{projects ? "No maps yet" : "No map open"}</p>
          <Button variant="outline" onClick={() => void startNewMap()}>
            <IconMapPlus data-icon="inline-start" />
            New map
          </Button>
        </div>
      )}
    </aside>
  )
}
