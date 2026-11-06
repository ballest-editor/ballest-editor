import { type ProjectInfo, type RecentProject, RELEASES_URL } from "@ballest/contracts"
import { IconDots, IconExternalLink, IconFolder, IconFolderOpen, IconPlus } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { parentFolderName, pathInFolder, shortFolderName } from "../domain/paths"
import { isProjectName, PROJECT_NAME_RULE, sharedProjectNames } from "../domain/project"
import { formatAgo, formatDateTime } from "../domain/time"
import {
  chooseProject,
  forgetRecentProject,
  newProject,
  openExternalLink,
  openRecentInNewWindow,
  pickProjectFolder,
  revealRecentProject,
  switchProject
} from "../editor/actions"
import { useEditor, useUpdateState } from "../editor/store"
import { HeroBand } from "./HeroBand"
import { Logo } from "./Logo"
import { SectionTitle } from "./SectionTitle"
import { START_CARD } from "./startCard"

/** A recent project's "…": what a click on its row doesn't do. */
function RecentMenu({ project, elsewhere }: { readonly project: RecentProject; readonly elsewhere: boolean }) {
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void forgetRecentProject(project.path)}>Remove from recent</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One recent project: its name and when it was last opened, the whole path and the exact time on hover. Its parent
 * folder shows only when another recent project has the same name. A click opens it here. One open in another window
 * can't be picked, and says so where the time would be.
 */
function RecentRow({ project, elsewhere, first, nameShared, now }: {
  readonly project: RecentProject
  readonly elsewhere: boolean
  /** The row Enter opens: it takes the focus. */
  readonly first: boolean
  readonly nameShared: boolean
  readonly now: number
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
                "flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left focus-visible:outline-none",
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
          <span className="min-w-0 flex-1 truncate text-fg-tertiary">{nameShared && parentFolderName(path)}</span>
          {elsewhere
            ? <span className="shrink-0 text-fg-disabled">Open in another window</span>
            : lastOpened !== null && <span className="shrink-0 text-fg-tertiary">{formatAgo(lastOpened, now)}</span>}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <div>{path}</div>
          {lastOpened !== null && <div>Last opened {formatDateTime(lastOpened)}</div>}
        </TooltipContent>
      </Tooltip>
      <RecentMenu project={project} elsewhere={elsewhere} />
    </li>
  )
}

/** The projects used before, the one Enter opens first. */
function RecentProjects() {
  const state = useEditor((s) => s.project)
  const recent = state?.recent ?? []
  const openElsewhere = state?.openElsewhere ?? []
  const [now] = useState(Date.now)
  const firstPickable = recent.find(({ path }) => !openElsewhere.includes(path))?.path
  const sharedNames = sharedProjectNames(recent)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SectionTitle>Recent projects</SectionTitle>
      <ul className={cn("flex flex-col gap-0.5 p-1", START_CARD)}>
        {recent.map((project) => (
          <RecentRow
            key={project.path}
            project={project}
            elsewhere={openElsewhere.includes(project.path)}
            first={project.path === firstPickable}
            nameShared={sharedNames.has(project.name.toLowerCase())}
            now={now}
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * The start screen's right column. A project's maps would belong here, but `listMaps` answers for the project in use,
 * and this screen has none. The version comes from the updater, which a browser doesn't have.
 */
function WhatsNew() {
  const update = useUpdateState()
  return (
    <aside className="flex flex-col gap-2 self-start">
      <SectionTitle>What's new</SectionTitle>
      <div className={cn("flex flex-col items-start gap-2 p-dialog", START_CARD)}>
        {update !== null && <p className="text-body-strong tabular-nums">Version {update.currentVersion}</p>}
        <p className="text-fg-tertiary">Each release lists what it added and fixed.</p>
        <Button variant="outline" onClick={() => void openExternalLink(RELEASES_URL)}>
          <IconExternalLink data-icon="inline-start" />
          Release notes
        </Button>
      </div>
    </aside>
  )
}

/**
 * Starts a project: a name, and the folder that makes it, which Change… replaces with one from a dialog. `onBack` goes
 * back to the recent projects; without any there, Open project… takes its place.
 */
function NewProjectForm({ onBack }: { readonly onBack: (() => void) | null }) {
  const state = useEditor((s) => s.project)
  const projectsFolder = state?.projectsFolder ?? ""
  const recent = state?.recent ?? []
  const [name, setName] = useState("")
  // the folder Change… picked; null: `<projectsFolder>/<name>`
  const [chosen, setChosen] = useState<ProjectInfo | null>(null)
  const trimmed = name.trim()
  const badName = trimmed !== "" && !isProjectName(trimmed)
  const taken = chosen === null && recent.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
  const holdsProject = chosen?.exists === true
  const folder = chosen?.path ?? (trimmed === "" ? projectsFolder : pathInFolder(projectsFolder, trimmed))
  const problem = badName
    ? PROJECT_NAME_RULE
    : taken
    ? "A recent project has that name already."
    : holdsProject
    ? "That folder already holds a project."
    : null
  const canCreate = isProjectName(trimmed) && problem === null
  const change = async () => {
    const picked = await pickProjectFolder()
    if (picked !== undefined && picked !== null) setChosen(picked)
  }
  return (
    <form
      className={cn("flex flex-col gap-4 p-dialog", START_CARD)}
      onSubmit={(e) => {
        e.preventDefault()
        if (canCreate) void newProject(trimmed, chosen?.path)
      }}
    >
      <h2 className="text-title">Start a new project</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="start-project-name">Name</Label>
        <Input
          id="start-project-name"
          autoFocus
          value={name}
          placeholder="Season 3 tracks"
          aria-invalid={badName || taken}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <IconFolder className="size-4 shrink-0 text-fg-secondary" />
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 flex-1 truncate text-fg-secondary" />}>
            {shortFolderName(folder)}
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">{folder}</TooltipContent>
        </Tooltip>
        <Button type="button" variant="outline" className="shrink-0" onClick={() => void change()}>Change…</Button>
      </div>
      {problem !== null && <p className="text-destructive">{problem}</p>}
      <div className="flex justify-end gap-2">
        {onBack === null
          ? <Button type="button" variant="outline" onClick={() => void chooseProject()}>Open project…</Button>
          : <Button type="button" variant="outline" onClick={onBack}>Back</Button>}
        <Button type="submit" disabled={!canCreate}>Create</Button>
      </div>
    </form>
  )
}

/**
 * What a window shows when it can't start on a project of its own (docs/DESKTOP.md § Other windows): the whole window,
 * in the editor's place, until a project is in use. Leaving it some other way would make a second Untitled Project, so
 * there is nothing to dismiss; closing the window is the way out. The strip along the top is the window's title bar:
 * it drags the window, and Electron draws the window controls over one end of it.
 */
export function ProjectChooser() {
  const noRecent = useEditor((s) => (s.project?.recent ?? []).length === 0)
  const [naming, setNaming] = useState(false)
  const showForm = naming || noRecent
  return (
    <div className="flex h-svh flex-col bg-background bg-linear-to-b from-primary/6 to-transparent to-60% text-foreground">
      <div className="h-10 shrink-0 [-webkit-app-region:drag]" />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-10">
        {/* `m-auto`, not `justify-center`: a list too long for the window scrolls from its top, where centring would clip it */}
        <div className="m-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)_16rem] gap-x-8 gap-y-6">
          <HeroBand className={cn("col-span-2 p-6", START_CARD)}>
            <div className="flex items-center gap-3">
              <Logo className="size-12 shrink-0" />
              <div>
                <h1 className="text-title">Ballest Editor</h1>
                <p className="text-fg-secondary">A map editor for Ballest of Them All.</p>
              </div>
            </div>
            {!showForm && (
              <div className="mt-4 flex items-center gap-2">
                <Button onClick={() => setNaming(true)}>
                  <IconPlus data-icon="inline-start" />
                  New project
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void chooseProject()}
                >
                  <IconFolderOpen data-icon="inline-start" />
                  Open project…
                </Button>
              </div>
            )}
          </HeroBand>
          {showForm ? <NewProjectForm onBack={noRecent ? null : () => setNaming(false)} /> : <RecentProjects />}
          <WhatsNew />
        </div>
      </main>
    </div>
  )
}
