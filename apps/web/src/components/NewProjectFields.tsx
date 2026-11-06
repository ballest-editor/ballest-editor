import type { ProjectInfo } from "@ballest/contracts"
import { IconFolderOpen, IconRestore } from "@tabler/icons-react"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useState } from "react"
import { pathInFolder } from "../domain/paths"
import { defaultProjectNameOf, isProjectName } from "../domain/project"
import { pickProjectFolder } from "../editor/actions"
import { useEditor } from "../editor/store"
import { PathAction, PathField } from "./PathText"

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

/** The Save map dialog's project name and folder, for the first Save in Untitled Project. */
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
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="saveAs-project">Project name</Label>
        <Input
          id="saveAs-project"
          value={name}
          aria-invalid={badName}
          onChange={(e) => setName(e.target.value)}
        />
        {badName && <span className="text-xs text-muted-foreground">Letters, digits, spaces, - and _ only.</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Project folder</span>
        <PathField
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
              <PathAction label="Choose…" icon={IconFolderOpen} onClick={() => void choose()} />
            </>
          }
        />
        {chosen?.exists === true && (
          <span className="text-xs text-destructive">
            That folder already holds a project. Open it with Open project…, or choose another.
          </span>
        )}
      </div>
    </>
  )
}
