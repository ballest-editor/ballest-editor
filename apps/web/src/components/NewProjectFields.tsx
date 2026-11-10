import type { ProjectInfo } from "@ballest/contracts"
import { IconFolder, IconRestore } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ReactNode, useState } from "react"
import { folderLabelOf, pathInFolder } from "../domain/paths"
import { defaultProjectNameOf, isProjectName, PROJECT_NAME_RULE } from "../domain/project"
import { pickProjectFolder } from "../editor/actions"
import { useEditor } from "../editor/store"
import { PathAction } from "./PathText"

/** What's wrong with a field, under it. */
export const FIELD_ERROR = "text-body text-destructive"

/**
 * A project about to be made, by New project… or the first Save in Untitled Project: its name, offered free of the
 * recent projects', and a folder the user may have chosen.
 */
export const useNewProjectDraft = () => {
  const state = useEditor((s) => s.project)
  const known = [state?.current ?? null, ...state?.recent ?? []].flatMap((p) => p === null ? [] : [p.name])
  const offered = () => defaultProjectNameOf(known)
  const [name, setName] = useState(offered)
  // the folder Choose… picked; null: `<projectsFolder>/<name>`
  const [chosen, setChosen] = useState<ProjectInfo | null>(null)
  const trimmed = name.trim()
  // in the usual folder, a recent project's name is its folder's: main would refuse it
  const taken = chosen === null && known.some((other) => other.toLowerCase() === trimmed.toLowerCase())
  return {
    name,
    setName,
    chosen,
    setChosen,
    reset: () => {
      setName(offered())
      setChosen(null)
    },
    // whether a project can be asked for: main has the last word (`canMakeProject`)
    ok: isProjectName(trimmed) && chosen?.exists !== true && !taken,
    taken,
    project: { name: trimmed, ...(chosen !== null && { folder: chosen.path }) }
  }
}

/**
 * Where a new project goes, by name: `folderLabelOf`, with the whole path in a tooltip. `actions` sit at the right. It
 * has no Reveal: the folder doesn't exist until the project is made.
 */
export function ProjectFolderLine({ actions, path }: { readonly actions?: ReactNode; readonly path: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <IconFolder className="size-4 shrink-0 text-fg-secondary" />
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 flex-1 truncate text-body text-fg-tertiary" />}>
          {folderLabelOf(path)}
        </TooltipTrigger>
        <TooltipContent side="bottom">{path}</TooltipContent>
      </Tooltip>
      {actions}
    </div>
  )
}

/**
 * A new project's name, and where it goes, with Change… for another folder: New project…, and what the first Save in
 * Untitled Project adds to the Save map dialog. The name offered is selected, so typing replaces it.
 */
export function NewProjectFields({ autoFocus = false, draft, id = "saveAs-project", label = "Project name" }: {
  readonly draft: ReturnType<typeof useNewProjectDraft>
  readonly id?: string
  readonly label?: string
  readonly autoFocus?: boolean
}) {
  const projectsFolder = useEditor((s) => s.project?.projectsFolder ?? "")
  const { chosen, name, setChosen, setName, taken } = draft
  const trimmed = name.trim()
  const badName = trimmed !== "" && !isProjectName(trimmed)
  const choose = async () => {
    const picked = await pickProjectFolder()
    if (picked !== undefined && picked !== null) setChosen(picked)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        autoFocus={autoFocus}
        value={name}
        aria-invalid={badName || taken}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
      />
      {badName && <span className={FIELD_ERROR}>{PROJECT_NAME_RULE}</span>}
      {taken && <span className={FIELD_ERROR}>A recent project has that name already.</span>}
      <ProjectFolderLine
        path={chosen?.path ?? pathInFolder(projectsFolder, trimmed)}
        actions={
          <>
            {chosen !== null && (
              <PathAction
                label="Use the usual folder"
                icon={IconRestore}
                onClick={() => setChosen(null)}
              />
            )}
            <Button type="button" variant="ghost" onClick={() => void choose()}>Change…</Button>
          </>
        }
      />
      {chosen?.exists === true && <span className={FIELD_ERROR}>That folder already holds a project.</span>}
    </div>
  )
}
