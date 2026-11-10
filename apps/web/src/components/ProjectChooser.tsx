import { type RecentProject, RELEASES_URL } from "@ballest/contracts"
import { IconDots, IconExternalLink, IconFolderOpen, IconLoader2, IconPlus } from "@tabler/icons-react"
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
import { useEffect, useState } from "react"
import { parentPathOf } from "../domain/paths"
import { formatAgo, formatDateTime } from "../domain/time"
import {
  chooseProject,
  forgetRecentProject,
  listProjectsFolder,
  openExternalLink,
  openRecentInNewWindow,
  revealRecentProject,
  switchProject
} from "../editor/actions"
import { useEditor, useUpdateState } from "../editor/store"
import { HeroBand } from "./HeroBand"
import { Logo } from "./Logo"
import { NewProjectDialog } from "./NewProjectDialog"
import { START_CARD } from "./startCard"
import { StartAction, StartList, StartSection } from "./startLists"

/** A project row's "…": what a click on it doesn't do. Remove from recent only for a recent one. */
function RecentMenu({ elsewhere, project, recent }: {
  readonly project: RecentProject
  readonly elsewhere: boolean
  readonly recent: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={`More for ${project.name}`} />}
      >
        <IconDots />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max">
        <DropdownMenuItem disabled={elsewhere} onClick={() => void openRecentInNewWindow(project)}>
          Open in new window
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void revealRecentProject(project.path)}>Reveal in folder</DropdownMenuItem>
        {recent && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void forgetRecentProject(project.path)}>
              Remove from recent
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One project, as VS Code's Welcome page lists one: its name, then `detail` dimmed (where a recent one is, when one in
 * the projects folder was last opened). The whole path and when it was last opened are on hover. A click opens it
 * here. One open in another window can't be picked, and says so in the detail's place.
 */
function RecentRow({ detail, elsewhere, first, project, recent }: {
  readonly project: RecentProject
  readonly detail: string
  readonly elsewhere: boolean
  /** The row Enter opens: it takes the focus. */
  readonly first: boolean
  readonly recent: boolean
}) {
  const { lastOpened, name, path } = project
  // Chromium counts autofocus as :focus-visible, so the first row would look hovered until the focus leaves it once.
  const [resting, setResting] = useState(first)
  return (
    <li
      className={cn(
        "flex h-8 items-center gap-1 rounded-control pr-1 transition-colors hover:bg-hover active:bg-pressed",
        !resting && "focus-ring-row"
      )}
    >
      <Tooltip
        // the first row has the focus from the start, and its path shouldn't sit over the rows below until it's asked for
        onOpenChange={(open, details) => {
          if (first && open && details.reason === "trigger-focus") details.cancel()
        }}
      >
        <TooltipTrigger
          render={
            <button
              type="button"
              autoFocus={first}
              // not `disabled`: that would take the tooltip, and the path, away from the row
              aria-disabled={elsewhere}
              className={cn(
                "flex h-full min-w-0 flex-1 items-center gap-3 pl-2 text-left focus-visible:outline-none",
                elsewhere && "cursor-default"
              )}
              onClick={elsewhere ? undefined : () => void switchProject(path)}
              // the window losing the focus leaves the row the active element, and it isn't the focus moving on
              onBlur={(e) => {
                if (document.activeElement !== e.currentTarget) setResting(false)
              }}
            />
          }
        >
          <span className={cn("max-w-1/2 shrink-0 truncate text-body-strong", elsewhere && "text-fg-secondary")}>
            {name}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", elsewhere ? "text-fg-disabled" : "text-fg-tertiary")}>
            {elsewhere ? "Open in another window" : detail}
          </span>
        </TooltipTrigger>
        {/* the path whole, on one line where it fits and broken anywhere where it doesn't, then when, quieter */}
        <TooltipContent side="bottom" align="start" className="max-w-md">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="[overflow-wrap:anywhere]">{path}</span>
            <span className="opacity-70">
              {lastOpened === null ? "Not opened here yet" : `Last opened ${formatDateTime(lastOpened)}`}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
      <RecentMenu project={project} elsewhere={elsewhere} recent={recent} />
    </li>
  )
}

const ALL_PROJECTS_KEY = "ballest-editor.welcome.allProjects"

/** Whether this machine's welcome window last listed all the projects folder's projects; a convenience, so never sure. */
const readAllProjects = () => {
  try {
    return localStorage.getItem(ALL_PROJECTS_KEY) === "1"
  } catch {
    return false
  }
}

const keepAllProjects = (all: boolean) => {
  try {
    localStorage.setItem(ALL_PROJECTS_KEY, all ? "1" : "0")
  } catch {
    // only a convenience: the next launch shows Recent
  }
}

/** The projects in the projects folder, by name, read again each time they are shown; null until they are. */
const useProjectsFolder = (shown: boolean) => {
  const [projects, setProjects] = useState<ReadonlyArray<RecentProject> | null>(null)
  useEffect(() => {
    if (!shown) return
    let current = true
    void listProjectsFolder().then((listed) => {
      if (current) setProjects(listed ?? [])
    })
    return () => {
      current = false
    }
  }, [shown])
  return projects
}

/**
 * Recent: the projects used before, most recent first, each with the folder it is in; or, switched to, every project
 * in the projects folder by name, each with when it was last opened. Enter opens the first that can be; a long list
 * scrolls in the space it has. Which of the two shows is kept for the next launch.
 */
function RecentProjects() {
  const state = useEditor((s) => s.project)
  const recent = state?.recent ?? []
  const openElsewhere = state?.openElsewhere ?? []
  const projectsFolder = state?.projectsFolder ?? ""
  const [all, setAll] = useState(readAllProjects)
  const inFolder = useProjectsFolder(all)
  const [now] = useState(Date.now)
  const shown = all ? inFolder ?? [] : recent
  const firstPickable = shown.find(({ path }) => !openElsewhere.includes(path))?.path
  const recentPaths = new Set(recent.map((p) => p.path))
  const toggle = () => {
    keepAllProjects(!all)
    setAll(!all)
  }
  return (
    <StartSection
      className="min-h-0 flex-1"
      title={all ? "All projects" : "Recent"}
      action={
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="rounded-control px-1 text-caption text-fg-secondary transition-colors focus-ring hover:text-foreground"
                onClick={toggle}
              />
            }
          >
            {all ? "Show recent" : "Show all"}
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            {all ? "Projects used before, most recent first" : `Every project in ${projectsFolder}`}
          </TooltipContent>
        </Tooltip>
      }
    >
      {all && inFolder === null ? <p className="text-fg-tertiary">Looking in {projectsFolder}…</p> : (
        shown.length === 0
          ? (
            <p className="text-fg-tertiary">
              {all
                ? `No projects in ${projectsFolder} yet.`
                : "No recent projects yet. Start a new one, or open a project folder."}
            </p>
          )
          : (
            // the list takes what the column has left and scrolls in it: the window itself never scrolls or grows
            // its bottom edge fades rather than cuts a row in half, and the end clears the fade once scrolled to
            // one per list: a scroll area measures its content once, and kept its scrollbar for a shorter list
            <ScrollArea
              key={all ? "all" : "recent"}
              className="-mx-2 min-h-0 flex-1 [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]"
            >
              <div className="pr-3 pb-8 pl-2">
                <StartList>
                  {shown.map((project) => (
                    <RecentRow
                      key={project.path}
                      project={project}
                      detail={all
                        ? project.lastOpened === null
                          ? "Not opened here yet"
                          : `Opened ${formatAgo(project.lastOpened, now)}`
                        : parentPathOf(project.path)}
                      elsewhere={openElsewhere.includes(project.path)}
                      first={project.path === firstPickable}
                      recent={recentPaths.has(project.path)}
                    />
                  ))}
                </StartList>
              </div>
            </ScrollArea>
          )
      )}
    </StartSection>
  )
}

/**
 * The start screen's right column, where VS Code's Welcome page has its walkthroughs. The version comes from the
 * updater, which a browser doesn't have.
 */
function WhatsNew() {
  const update = useUpdateState()
  return (
    <StartSection title="What's new" className="self-start">
      {update !== null && <p className="text-body-strong tabular-nums">Version {update.currentVersion}</p>}
      <p className="text-fg-tertiary">Each release lists what it added and fixed.</p>
      <Button variant="outline" className="self-start" onClick={() => void openExternalLink(RELEASES_URL)}>
        <IconExternalLink data-icon="inline-start" />
        Release notes
      </Button>
    </StartSection>
  )
}

/**
 * The welcome window (docs/DESKTOP.md § Other windows), after VS Code's Welcome page: Start and Recent down the left,
 * What's new on the right. New project… asks in a dialog of the window's own. Every launch shows it, in a small window of its own, until a project is in use. Leaving it
 * some other way would make a second Untitled Project, so there is nothing to dismiss; closing the window is the way
 * out. The strip along the top is the window's title bar: it drags the window, and Electron draws the window controls
 * over one end of it.
 */
export function ProjectChooser() {
  const [naming, setNaming] = useState(false)
  const entering = useEditor((s) => s.enteringProject)
  return (
    <div
      className={cn(
        "flex h-svh flex-col bg-background text-foreground",
        // empty, the editor's own background, for the moment the window grows into the editor
        entering?.phase !== "showing" && "bg-linear-to-b from-primary/6 to-transparent to-60%"
      )}
    >
      <div className="h-10 shrink-0 [-webkit-app-region:drag]" />
      {/* a fixed frame: only Recent's list scrolls, so switching lists or a long one never moves the rest */}
      <main
        aria-busy={entering !== null}
        className={cn(
          "flex min-h-0 flex-1 justify-center px-8 pt-4 pb-8",
          entering?.phase === "showing" && "invisible"
        )}
      >
        <div className="grid min-h-0 w-full max-w-3xl grid-cols-[minmax(0,1fr)_13rem] grid-rows-[auto_minmax(0,1fr)] gap-x-12 gap-y-8">
          <HeroBand className={cn("col-span-2 p-5", START_CARD)}>
            <div className="flex items-center gap-3">
              <Logo className="size-11 shrink-0" />
              <div>
                <h1 className="text-title">Ballest Editor</h1>
                {entering === null
                  ? <p className="text-fg-secondary">A map editor for Ballest of Them All.</p>
                  : (
                    <p className="flex items-center gap-1.5 text-fg-secondary" role="status">
                      <IconLoader2 className="size-4 animate-spin" />
                      Opening {entering.name}…
                    </p>
                  )}
              </div>
            </div>
          </HeroBand>
          {/* nothing else can be picked while a pick opens */}
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-col gap-8 transition-opacity",
              entering !== null && "pointer-events-none opacity-50"
            )}
          >
            <StartSection title="Start">
              <StartList>
                <StartAction icon={<IconPlus />} label="New project…" onClick={() => setNaming(true)} />
                <StartAction icon={<IconFolderOpen />} label="Open project…" onClick={() => void chooseProject()} />
              </StartList>
            </StartSection>
            <RecentProjects />
          </div>
          <WhatsNew />
        </div>
      </main>
      {/* the window's own: the store opens no dialog over the chooser */}
      <NewProjectDialog open={naming} onClose={() => setNaming(false)} />
    </div>
  )
}
