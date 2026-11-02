import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDashed,
  IconDotsVertical,
  IconFileImport,
  IconMap,
  IconPencil,
  IconPlus,
  IconRefreshAlert,
  IconSettings,
  IconWorldUpload
} from "@tabler/icons-react"
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
import { type ComponentType, type MouseEvent, useRef } from "react"
import { mapLabelOf } from "../domain/factory"
import { LINK_STATE_LABELS, type LinkState, linkStateOf } from "../domain/linkState"
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
import { type ProjectMap, useEditor, useOpenMapLabel } from "../editor/store"
import { useNow } from "../editor/useNow"

const STATE_ICONS: Record<LinkState, ComponentType<{ readonly className?: string }>> = {
  notExported: IconCircleDashed,
  inSync: IconCircleCheck,
  editedSinceExport: IconPencil,
  changedInGame: IconRefreshAlert,
  bothChanged: IconAlertTriangle,
  publishedDraft: IconWorldUpload
}

const STATE_TONES: Partial<Record<LinkState, string>> = {
  inSync: "text-emerald-600 dark:text-emerald-400",
  changedInGame: "text-amber-600 dark:text-amber-400",
  bothChanged: "text-amber-600 dark:text-amber-400"
}

/** A map's link state as one glyph, its name on hover; the row has no room for the words. */
function StateGlyph({ state }: { readonly state: LinkState }) {
  const Icon = STATE_ICONS[state]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn("inline-flex shrink-0", STATE_TONES[state])} aria-label={LINK_STATE_LABELS[state]} />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="right">{LINK_STATE_LABELS[state]}</TooltipContent>
    </Tooltip>
  )
}

/** The dot a map carries while it is open with unsaved edits, or isn't saved anywhere yet (the tab shows the same). */
function UnsavedDot() {
  return <span className="size-1.5 shrink-0 rounded-full bg-foreground/70" aria-label="unsaved" />
}

/** What the row has no room for: the full name, where the file is (or that it isn't saved), when it was edited. */
function RowDetails(
  { name, path, edited, unsaved }: {
    readonly name: string
    readonly path: string | null
    readonly edited: string | null
    readonly unsaved: boolean
  }
) {
  return (
    <div className="flex max-w-xs flex-col gap-0.5">
      <span className="font-medium">{name}</span>
      {path !== null && <span className="font-mono text-[0.65rem] break-all opacity-80">{path}</span>}
      {unsaved && <span className="opacity-80">{path === null ? "Not saved yet" : "Unsaved edits"}</span>}
      {edited !== null && <span className="opacity-80">edited {edited}</span>}
    </div>
  )
}

const ROW_CLASSES =
  "group flex h-7 min-w-0 items-center gap-1.5 rounded-sm pr-1 pl-2 text-xs hover:bg-muted/60 has-[button:focus-visible]:bg-muted/60"

/**
 * One of the project's maps: a click opens it, its menu (also on right-click) holds what used to be the Project menu's
 * per-map items. The open map is highlighted and carries a dot while it has unsaved edits.
 */
function MapRow({ map, now }: { readonly map: ProjectMap; readonly now: number }) {
  const isOpen = useEditor((s) => s.file?.name === map.fileName)
  const dirty = useEditor((s) => s.dirty)
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const canPlay = useEditor((s) => s.capabilities.play)
  const menuButton = useRef<HTMLButtonElement>(null)
  const label = mapLabelOf(map.fileName)
  const unsaved = isOpen && dirty
  const state = linkStateOf(map, { unsaved })
  // right-click opens the same menu the ⋮ button does
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    menuButton.current?.click()
  }
  return (
    <li className={cn(ROW_CLASSES, isOpen && "bg-muted/40")} onContextMenu={onContextMenu}>
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
          <IconMap className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", isOpen && "font-medium")}>{label}</span>
          {unsaved && <UnsavedDot />}
        </TooltipTrigger>
        <TooltipContent side="right" align="start">
          <RowDetails
            name={label}
            path={map.path}
            edited={`${formatAgo(map.modifiedAt, now)} (${formatDateTime(map.modifiedAt)})`}
            unsaved={unsaved}
          />
        </TooltipContent>
      </Tooltip>
      <StateGlyph state={state} />
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={menuButton}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
              aria-label={`More for ${label}`}
            />
          }
        >
          <IconDotsVertical className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={isOpen} onClick={() => void openProjectMap(map.fileName)}>Open</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void nameProjectMap(map.fileName, "rename")}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void nameProjectMap(map.fileName, "duplicate")}>Duplicate…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void nameProjectMap(map.fileName, "recover")}>
            Recover previous version…
          </DropdownMenuItem>
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
          <DropdownMenuItem onClick={() => void revealProject()}>Reveal</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** The open map while it has no file yet (a fresh map, or any map in Untitled Project): a row of its own. */
function UnsavedRow() {
  const label = useOpenMapLabel()
  return (
    <li className={cn(ROW_CLASSES, "bg-muted/40")}>
      <Tooltip>
        <TooltipTrigger render={<span className="flex min-w-0 flex-1 items-center gap-1.5" />}>
          <IconMap className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium italic">{label}</span>
          <UnsavedDot />
        </TooltipTrigger>
        <TooltipContent side="right" align="start">
          <RowDetails name={label} path={null} edited={null} unsaved />
        </TooltipContent>
      </Tooltip>
    </li>
  )
}

function HeaderButton(
  { label, onClick, disabled, children }: {
    readonly label: string
    readonly onClick: () => void
    readonly disabled?: boolean
    readonly children: React.ReactNode
  }
) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The left dock's Project tab (docs/PROJECTS.md § Shell): the project and its maps as a tree, the way an editor's
 * file explorer shows a workspace. A click opens a map; the open one is highlighted, with a dot while it has unsaved
 * edits, and each row shows its link state. The header holds New map, Import and Project settings. In a browser,
 * which has no project, it shows the one map in memory.
 */
export function ProjectPanel() {
  const projects = useEditor((s) => s.capabilities.projects)
  const project = useEditor((s) => s.project?.current ?? null)
  const maps = useEditor((s) => s.projectMaps)
  const unsaved = useEditor((s) => s.file === null)
  const openDialog = useEditor((s) => s.openDialog)
  const now = useNow()
  const untitled = projects && project === null
  return (
    <aside className="flex h-full min-w-0 flex-col gap-1 bg-card p-2">
      <div className="flex h-6 items-center gap-1 px-1">
        <span
          className={cn("min-w-0 flex-1 truncate text-xs font-medium", untitled && "italic text-muted-foreground")}
          title={project?.path ?? (untitled ? "Not saved anywhere yet: Save the map to name the project." : undefined)}
        >
          {projects ? project?.name ?? "Untitled Project *" : "This browser"}
        </span>
        <HeaderButton label="New map…" onClick={() => void startNewMap()}>
          <IconPlus />
        </HeaderButton>
        <HeaderButton label={projects ? "Import map…" : "Open…"} disabled={untitled} onClick={() => void importMap()}>
          <IconFileImport />
        </HeaderButton>
        {projects && (
          <HeaderButton label="Project settings…" onClick={() => openDialog("projectSettings")}>
            <IconSettings />
          </HeaderButton>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-px pr-2">
          {unsaved && <UnsavedRow />}
          {maps.map((map) => <MapRow key={map.fileName} map={map} now={now} />)}
        </ul>
        {untitled && (
          <p className="px-2 py-3 text-[0.7rem] text-muted-foreground">
            Save the map to name the project; it is kept in Documents/Ballest Editor from then on.
          </p>
        )}
      </ScrollArea>
    </aside>
  )
}
