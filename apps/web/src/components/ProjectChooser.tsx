import { IconFolderOpen, IconPlus } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { useState } from "react"
import { chooseProject, newProject, quitApp, switchProject } from "../editor/actions"
import { isChooserRequired, useEditor } from "../editor/store"
import { NewProjectForm } from "./NewProjectDialog"
import { PathText } from "./PathText"

const quitThisWindow = (
  <Button type="button" variant="ghost" className="mr-auto" onClick={() => void quitApp()}>Quit this window</Button>
)

/**
 * What a window shows when it can't start on a project of its own (docs/DESKTOP.md § Other windows). It can't be
 * dismissed: `open` follows main, there is no close button, and Escape or a click outside change nothing, because
 * leaving it would make a second Untitled Project. Quit this window is the way out. Behind it is the blank map the app
 * always has, which nothing can reach: the store opens no other dialog meanwhile, and the editor's keys are off.
 */
export function ProjectChooser() {
  const open = useEditor(isChooserRequired)
  const project = useEditor((s) => s.project)
  const recent = project?.recent ?? []
  const openElsewhere = project?.openElsewhere ?? []
  const [naming, setNaming] = useState(false)
  // nothing to list: the only thing left to do here is to start one
  const newOnly = recent.length === 0

  return (
    <Dialog open={open} disablePointerDismissal>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{naming || newOnly ? "Start a new project" : "Choose a project"}</DialogTitle>
          <DialogDescription>A window works on one project, and a project opens in one window.</DialogDescription>
        </DialogHeader>
        {naming || newOnly
          ? (
            <NewProjectForm
              actions={
                <>
                  {quitThisWindow}
                  {newOnly
                    ? (
                      <Button type="button" variant="outline" onClick={() => void chooseProject()}>
                        Open project…
                      </Button>
                    )
                    : <Button type="button" variant="outline" onClick={() => setNaming(false)}>Back</Button>}
                </>
              }
              onCreate={(name) => void newProject(name)}
            />
          )
          : (
            <>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => void chooseProject()}>
                  <IconFolderOpen data-icon="inline-start" />
                  Open project…
                </Button>
                <Button onClick={() => setNaming(true)}>
                  <IconPlus data-icon="inline-start" />
                  New project
                </Button>
              </div>
              <ul className="flex max-h-72 flex-col overflow-y-auto rounded-md ring-1 ring-foreground/10">
                {recent.map(({ name, path }) => {
                  const elsewhere = openElsewhere.includes(path)
                  return (
                    <li key={path} className="border-b border-foreground/10 last:border-b-0">
                      <button
                        type="button"
                        disabled={elsewhere}
                        className="flex w-full min-w-0 flex-col gap-1 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none"
                        onClick={() => void switchProject(path)}
                      >
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className={elsewhere ? "truncate text-muted-foreground" : "truncate"}>
                            {name}
                          </span>
                          {elsewhere && <span className="shrink-0 text-muted-foreground">Open in another window</span>}
                        </span>
                        <PathText block className="text-muted-foreground">{path}</PathText>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="flex">{quitThisWindow}</div>
            </>
          )}
      </DialogContent>
    </Dialog>
  )
}
