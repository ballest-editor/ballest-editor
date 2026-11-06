import type { ProjectInfo, RecentProject } from "@ballest/contracts"
import { IconDots, IconFolder, IconFolderOpen, IconPlus } from "@tabler/icons-react"
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
import { isProjectName } from "../domain/project"
import { formatAgo } from "../domain/time"
import {
  chooseProject,
  forgetRecentProject,
  newProject,
  openRecentInNewWindow,
  pickProjectFolder,
  revealRecentProject,
  switchProject
} from "../editor/actions"
import { useEditor } from "../editor/store"
import { SectionTitle } from "./SectionTitle"

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
        <DropdownMenuItem onClick={() => void revealRecentProject(project.path)}>Reveal</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void forgetRecentProject(project.path)}>Remove from recent</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One recent project: its name, the folder it's in and when it was last opened, the whole path on hover. A click opens
 * it here. One open in another window can't be picked, and says so where the time would be.
 */
function RecentRow({ project, elsewhere, first, now }: {
  readonly project: RecentProject
  readonly elsewhere: boolean
  /** The row Enter opens: it takes the focus. */
  readonly first: boolean
  readonly now: number
}) {
  const { lastOpened, name, path } = project
  return (
    <li className="flex h-8 items-center gap-1 rounded-control pr-1 focus-within:bg-muted hover:bg-muted">
      <Tooltip
        // the first row has the focus from the start, and its path shouldn't sit over the rows below until it's asked for
        onOpenChange={(open, details) => {
          if (first && open && details.reason === "trigger-focus") details.cancel()
        }}
      >
        <TooltipTrigger
          render={
            // not `disabled`: that would take the tooltip, and the path, away from the row


              <button
                type="button"
                autoFocus={first}
                aria-disabled={elsewhere}
                className={cn(
                  "flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left outline-none",
                  elsewhere && "cursor-default"
                )}
                onClick={elsewhere ? undefined : () => void switchProject(path)}
              />

          }
        >
          <span className={cn("max-w-1/2 shrink-0 truncate text-body-strong", elsewhere && "text-fg-disabled")}>
            {name}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", elsewhere ? "text-fg-disabled" : "text-fg-tertiary")}>
            {parentFolderName(path)}
          </span>
          <span className="shrink-0 text-fg-tertiary">
            {elsewhere ? "Open in another window" : lastOpened === null ? null : formatAgo(lastOpened, now)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">{path}</TooltipContent>
      </Tooltip>
      <RecentMenu project={project} elsewhere={elsewhere} />
    </li>
  )
}

/** The recent projects, and the two ways to anything else. */
function StartScreen({ onNew }: { readonly onNew: () => void }) {
  const state = useEditor((s) => s.project)
  const recent = state?.recent ?? []
  const openElsewhere = state?.openElsewhere ?? []
  const [now] = useState(Date.now)
  const firstPickable = recent.find(({ path }) => !openElsewhere.includes(path))?.path
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="mr-auto">
          <SectionTitle>Recent projects</SectionTitle>
        </div>
        <Button variant="outline" onClick={() => void chooseProject()}>
          <IconFolderOpen data-icon="inline-start" />
          Open project…
        </Button>
        <Button onClick={onNew}>
          <IconPlus data-icon="inline-start" />
          New project
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5 rounded-surface border bg-card p-1">
        {recent.map((project) => (
          <RecentRow
            key={project.path}
            project={project}
            elsewhere={openElsewhere.includes(project.path)}
            first={project.path === firstPickable}
            now={now}
          />
        ))}
      </ul>
    </>
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
    ? "Letters, digits, spaces, - and _ only."
    : taken
    ? "A recent project has that name already."
    : holdsProject
    ? "That folder already holds a project."
    : null
  const change = async () => {
    const picked = await pickProjectFolder()
    if (picked !== undefined && picked !== null) setChosen(picked)
  }
  return (
    <form
      className="flex flex-col gap-4 rounded-surface border bg-card p-dialog"
      onSubmit={(e) => {
        e.preventDefault()
        if (isProjectName(trimmed) && problem === null) void newProject(trimmed, chosen?.path)
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
        <Button type="submit" disabled={!isProjectName(trimmed) || problem !== null}>Create</Button>
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
  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <div className="h-10 shrink-0 [-webkit-app-region:drag]" />
      <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pb-10">
        <div className="flex w-full max-w-xl flex-col gap-4 pt-[10vh]">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-8" />
            <h1 className="text-title">Ballest Editor</h1>
          </div>
          {naming || noRecent
            ? <NewProjectForm onBack={noRecent ? null : () => setNaming(false)} />
            : <StartScreen onNew={() => setNaming(true)} />}
        </div>
      </main>
    </div>
  )
}
