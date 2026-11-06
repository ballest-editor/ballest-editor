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
import { useShallow } from "zustand/react/shallow"
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
import { type ProjectMap, tabsWithoutFile, useEditor, useHasUnsavedEdits, useTabSummary } from "../editor/store"
import { useNow } from "../editor/useNow"
import { PathText } from "./PathText"

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
  return <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" aria-label="unsaved" />
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
      <span className="text-body-strong">{name}</span>
      {path !== null && <PathText block className="opacity-80">{path}</PathText>}
      {unsaved && <span className="opacity-80">{path === null ? "Not saved yet" : "Unsaved edits"}</span>}
      {edited !== null && <span className="opacity-80">edited {edited}</span>}
    </div>
  )
}

const ROW_CLASSES =
  "group flex h-7 min-w-0 items-center gap-1.5 rounded-control pr-1 pl-2 text-body hover:bg-muted/60 has-[button:focus-visible]:bg-muted/60"

/** The map in the active tab: tinted, with a bar at its left, so it reads at a glance. */
const ACTIVE_ROW_CLASSES = "bg-primary/15 text-foreground shadow-[inset_2px_0_0_0] shadow-primary hover:bg-primary/20"

/**
 * One of the project's maps: a click opens it, its menu (also on right-click) holds what used to be the Project menu's
 * per-map items. The open map is highlighted and carries a dot while it has unsaved edits.
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
          <IconMap className="size-3.5 shrink-0 text-fg-secondary" />
          <span className={cn("truncate", isOpen && "text-body-strong")}>{label}</span>
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

/**
 * A tab whose map has no file yet (`tabsWithoutFile`): a row of its own, in italics, whichever tab is active. A click
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
          <IconMap className="size-3.5 shrink-0 text-fg-secondary" />
          {/* an italic's last letter leans past its box, and `truncate` would clip it without the padding */}
          <span className={cn("truncate pr-0.5 italic", isActive && "text-body-strong")}>{label}</span>
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
            className="text-fg-secondary"
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
 * The Project panel (docs/PROJECTS.md § Shell): the project and its maps as a tree, the way an editor's
 * file explorer shows a workspace. A click opens a map; the open one is highlighted, with a dot while it has unsaved
 * edits, and each row shows its link state. Every tab whose map has no file yet is a row too, above them. The header
 * holds New map, Import and Project settings. In a browser, which has no project, only those rows show.
 */
export function ProjectPanel() {
  const projects = useEditor((s) => s.capabilities.projects)
  const project = useEditor((s) => s.project?.current ?? null)
  const maps = useEditor((s) => s.projectMaps)
  const unsavedTabs = useEditor(useShallow(tabsWithoutFile))
  const openDialog = useEditor((s) => s.openDialog)
  const now = useNow()
  const untitled = projects && project === null
  return (
    <aside className="flex h-full min-w-0 flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate px-1 text-body-strong",
            untitled && "italic text-fg-tertiary"
          )}
          title={project?.path ?? (untitled ? "Not saved anywhere yet: saving a map creates the project." : undefined)}
        >
          {projects ? project?.name ?? "Untitled Project *" : "This browser"}
        </span>
        <HeaderButton label="New map" onClick={() => void startNewMap()}>
          <IconPlus className="size-3.5" />
        </HeaderButton>
        <HeaderButton label={projects ? "Import map…" : "Open…"} disabled={untitled} onClick={() => void importMap()}>
          <IconFileImport className="size-3.5" />
        </HeaderButton>
        {projects && (
          <HeaderButton label="Project settings…" onClick={() => openDialog({ id: "projectSettings" })}>
            <IconSettings className="size-3.5" />
          </HeaderButton>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {untitled && (
          <p className="px-3 pb-2 text-body text-fg-tertiary">
            No project yet. Saving a map creates one, and these maps can then be saved in it.
          </p>
        )}
        <ul className="flex flex-col gap-px px-2 pb-2">
          {unsavedTabs.map((tabId) => <UnsavedRow key={tabId} tabId={tabId} />)}
          {/* the tabs above aren't in the project; a rule keeps them from reading as its first maps */}
          {unsavedTabs.length > 0 && maps.length > 0 && (
            <li role="separator" aria-orientation="horizontal" className="mx-2 my-1 border-t border-border/60" />
          )}
          {maps.map((map) => <MapRow key={map.fileName} map={map} now={now} />)}
        </ul>
        {!projects && unsavedTabs.length === 0 && (
          <p className="px-3 py-2 text-caption text-fg-tertiary">
            This browser has no project: maps live in their tabs, and Save downloads the file. The desktop app keeps
            them in a project folder.
          </p>
        )}
      </ScrollArea>
    </aside>
  )
}
