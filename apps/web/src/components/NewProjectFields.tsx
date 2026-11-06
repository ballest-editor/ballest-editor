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

/** The project the Save map dialog makes in Untitled Project: its name, and a folder the user may have chosen. */
export const useNewProjectDraft = () => {
  const state = useEditor((s) => s.project)
  const offered = () => defaultProjectNameOf((state?.recent ?? []).map((p) => p.name))
  const [name, setName] = useState(offered)
  // the folder Choose… picked; null: `<projectsFolder>/<name>`
  const [chosen, setChosen] = useState<ProjectInfo | null>(null)
  const trimmed = name.trim()
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
    ok: isProjectName(trimmed) && chosen?.exists !== true,
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

/** What the first Save in Untitled Project adds to the Save map dialog: the project's name, and where it goes. */
export function NewProjectFields({ draft }: { readonly draft: ReturnType<typeof useNewProjectDraft> }) {
  const projectsFolder = useEditor((s) => s.project?.projectsFolder ?? "")
  const { chosen, name, setChosen, setName } = draft
  const trimmed = name.trim()
  const badName = trimmed !== "" && !isProjectName(trimmed)
  const choose = async () => {
    const picked = await pickProjectFolder()
    if (picked !== undefined && picked !== null) setChosen(picked)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="saveAs-project">Project name</Label>
      <Input
        id="saveAs-project"
        value={name}
        aria-invalid={badName}
        onChange={(e) => setName(e.target.value)}
      />
      {badName && <span className={FIELD_ERROR}>{PROJECT_NAME_RULE}</span>}
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
