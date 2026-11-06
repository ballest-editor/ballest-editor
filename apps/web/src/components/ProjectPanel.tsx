import { IconDotsVertical, IconDownload, IconMap, IconMapPlus, IconSettings } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
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
import { type MouseEvent, type ReactNode, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { mapLabelOf } from "../domain/factory"
import { type LinkState, linkStateDetailOf, linkStateOf, syncStatusOf } from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import {
  exportProjectMapFromPanel,
  importMap,
  nameProjectMap,
  openProjectMap,
  playProjectMapFromPanel,
  revealProject,
  startNewMap
} from "../editor/actions"
import { type ProjectMap, tabsWithoutFile, useEditor, useHasUnsavedEdits, useTabSummary } from "../editor/store"
import { useNow } from "../editor/useNow"
import { SyncStatusBadge } from "./SyncStatusChip"

/** A map's sync status, with its link state and when it was last exported on hover. */
function RowStatus(
  { map, state, unsaved, now }: {
    readonly map: ProjectMap
    readonly state: LinkState
    readonly unsaved: boolean
    readonly now: number
  }
) {
  return (
    <Tooltip>
      <TooltipTrigger render={<SyncStatusBadge status={syncStatusOf(state, unsaved)} />} />
      <TooltipContent side="bottom" align="end">{linkStateDetailOf(map, state, now)}</TooltipContent>
    </Tooltip>
  )
}

/** What the row has no room for: the full name, whether it has unsaved edits, when it was edited. */
function RowDetails(
  { name, unsaved, edited }: {
    readonly name: string
    readonly unsaved: string | null
    readonly edited: string | null
  }
) {
  return (
    <div className="flex max-w-xs flex-col gap-0.5">
      <span className="text-body-strong">{name}</span>
      {unsaved !== null && <span className="opacity-80">{unsaved}</span>}
      {edited !== null && <span className="opacity-80">Edited {edited}</span>}
    </div>
  )
}

const ROW_CLASSES =
  "group flex h-6 min-w-0 items-center gap-1.5 rounded-control pl-2 text-body hover:bg-muted/60 has-[button:focus-visible]:bg-muted/60"

/** The map in the active tab: tinted, with a bar at its left, so it reads at a glance. */
const ACTIVE_ROW_CLASSES = "bg-primary/15 text-foreground shadow-[inset_2px_0_0_0] shadow-primary hover:bg-primary/20"

/**
 * One of the project's maps: a click opens it, its menu (also on right-click) holds what used to be the Project menu's
 * per-map items. The open map is highlighted, and the badge says what it has unsaved or left to export. The tooltips
 * open below the row, so they never cover its badge or ⋮ button.
 */
function MapRow({ map, now }: { readonly map: ProjectMap; readonly now: number }) {
  const isOpen = useEditor((s) => s.file?.name === map.fileName)
  const unsaved = useHasUnsavedEdits(map.fileName)
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const canPlay = useEditor((s) => s.capabilities.play)
  const menuButton = useRef<HTMLButtonElement>(null)
  const label = mapLabelOf(map.fileName)
  const state = linkStateOf(map, { unsaved })
  // right-click opens the same menu the ⋮ button does
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    menuButton.current?.click()
  }
  return (
    <li className={cn(ROW_CLASSES, isOpen && ACTIVE_ROW_CLASSES)} onContextMenu={onContextMenu}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
              onClick={() => void openProjectMap(map.fileName)}
            />
          }
        >
          <IconMap className="size-4 shrink-0 text-fg-secondary" />
          <span className={cn("truncate", isOpen && "text-body-strong")}>{label}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <RowDetails
            name={label}
            unsaved={unsaved ? "Unsaved edits" : null}
            edited={`${formatAgo(map.modifiedAt, now)} (${formatDateTime(map.modifiedAt)})`}
          />
        </TooltipContent>
      </Tooltip>
      <RowStatus map={map} state={state} unsaved={unsaved} now={now} />
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={menuButton}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
              aria-label={`More for ${label}`}
            />
          }
        >
          <IconDotsVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={isOpen} onClick={() => void openProjectMap(map.fileName)}>Open</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void nameProjectMap(map.fileName, "rename")}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void nameProjectMap(map.fileName, "duplicate")}>Duplicate…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void nameProjectMap(map.fileName, "recover")}>Backups…</DropdownMenuItem>
          {canExport && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void exportProjectMapFromPanel(map.fileName)}>
                Export to game
              </DropdownMenuItem>
              {canPlay && (
                <DropdownMenuItem onClick={() => void playProjectMapFromPanel(map.fileName)}>Play</DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void revealProject()}>Reveal in folder</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/**
 * A tab whose map has no file yet (`tabsWithoutFile`): a row of its own, badged Unsaved, whichever tab is active. A click
 * makes it the active tab.
 */
function UnsavedRow({ tabId }: { readonly tabId: string }) {
  const { label } = useTabSummary(tabId)
  const isActive = useEditor((s) => s.tabId === tabId)
  const activateTab = useEditor((s) => s.activateTab)
  return (
    <li className={cn(ROW_CLASSES, isActive && ACTIVE_ROW_CLASSES)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
              onClick={() => activateTab(tabId)}
            />
          }
        >
          <IconMap className="size-4 shrink-0 text-fg-secondary" />
          <span className={cn("truncate", isActive && "text-body-strong")}>{label}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <RowDetails name={label} unsaved="Not saved yet" edited={null} />
        </TooltipContent>
      </Tooltip>
      <SyncStatusBadge status="unsaved" className="mr-7.5" />
    </li>
  )
}

/** A header action. The tooltip sits on a wrapper because a disabled button gets no hover, and that's when it says why. */
function HeaderButton(
  { label, onClick, disabled, children }: {
    readonly label: string
    readonly onClick: () => void
    readonly disabled?: boolean
    readonly children: ReactNode
  }
) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-fg-secondary"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const NAME_CLASSES = "min-w-0 flex-1 truncate text-body-strong"

/** What the header calls the project: its name, with its folder on hover, or a chip while it has none. */
function ProjectName({ name, path }: { readonly name: string | null; readonly path: string | null }) {
  if (name === null) {
    return (
      <span className="flex min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger render={<Badge variant="outline" className="text-fg-secondary" />}>Untitled</TooltipTrigger>
          <TooltipContent side="bottom">Saving a map creates the project</TooltipContent>
        </Tooltip>
      </span>
    )
  }
  if (path === null) return <span className={NAME_CLASSES}>{name}</span>
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={NAME_CLASSES} />}>{name}</TooltipTrigger>
      <TooltipContent side="bottom" className="break-all">{path}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The Project panel (docs/PROJECTS.md § Shell): the project and its maps as a tree, the way an editor's
 * file explorer shows a workspace. A click opens a map; the open one is highlighted, and each row shows its sync
 * status. Every tab whose map has no file yet is a row too, above them. The header
 * holds New map, Import map and Project settings. In a browser, which has no project, only those rows show.
 */
export function ProjectPanel() {
  const projects = useEditor((s) => s.capabilities.projects)
  const project = useEditor((s) => s.project?.current ?? null)
  const maps = useEditor((s) => s.projectMaps)
  const unsavedTabs = useEditor(useShallow(tabsWithoutFile))
  const openDialog = useEditor((s) => s.openDialog)
  const now = useNow()
  const untitled = projects && project === null
  // a project with no maps yet; Untitled Project is always that, with a tab's row above (closing the last opens another)
  const empty = maps.length === 0 && (projects || unsavedTabs.length === 0)
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
        <ul className="flex flex-col gap-px px-2 pb-2">
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
