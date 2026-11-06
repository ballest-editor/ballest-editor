import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useMemo, useState } from "react"
import { riskyClassesIn } from "../domain/Catalog"
import { usableCreatorName } from "../domain/creator"
import { copyNameOf, isValidName, mapFileNameOf } from "../domain/factory"
import { unconfirmedPropertiesIn } from "../domain/itemProperties"
import { classNameOf } from "../domain/MapFile"
import { pieceLabelOf } from "../domain/pieceName"
import {
  canMakeProject,
  duplicateMap,
  playAsNewDraft,
  renameOpenMap,
  saveMapAs,
  saveMapInNewProject
} from "../editor/actions"
import { useCreator, useEditor } from "../editor/store"
import { MapNameDialog } from "./MapNameDialog"
import { NewProjectFields, useNewProjectDraft } from "./NewProjectFields"
import { useOnOpen } from "./useOnOpen"

/**
 * Names the open map before it is written: `saveAs` for a map that has no file yet (desktop: into the project) or for
 * a browser's Export (a download); `rename` and `duplicate` from the Project menu; `newDraft`, Play's way out for a
 * published map's draft (the plugin manager races only maps never published): a duplicate that isn't linked to the
 * Workshop item, raced once it is saved. Every mode confirms the name, so a file never disagrees with the names inside
 * it (the game refuses to load those).
 */
export type NameMapMode = "saveAs" | "rename" | "duplicate" | "newDraft"

const ERROR = "text-body text-destructive"
const WARNING = "text-body text-status-warn-foreground"

export function NameMapDialog(
  { mode, open, onClose }: { readonly mode: NameMapMode; readonly open: boolean; readonly onClose: () => void }
) {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const openDialog = useEditor((s) => s.openDialog)
  const items = useEditor((s) => s.doc.map.items)
  const catalog = useEditor((s) => s.catalog)
  const projects = useEditor((s) => s.capabilities.projects)
  const project = useEditor((s) => s.project?.current ?? null)
  // The first Save in Untitled Project makes the project too (docs/DESKTOP.md § Projects and maps)
  const namesProject = projects && mode === "saveAs" && project === null
  const newProject = useNewProjectDraft()
  const projectMaps = useEditor((s) => s.projectMaps)
  const fileName = useEditor((s) => s.file?.name ?? null)
  // What the unsaved-changes prompt's Save (or Export, Play) goes on to do once the map is saved (close, a new map...):
  // Submit holds on to it as it closes the dialog, then saves; Cancel drops it with the dialog.
  const afterSave = useEditor((s) => s.dialog?.id === "saveAs" ? s.dialog.afterSave : undefined)
  const risky = useMemo(() => {
    const pieces = catalog?.catalog.pieces ?? []
    const classes = riskyClassesIn(items.map((it) => classNameOf(it.actorToSpawn)), pieces, catalog?.verified ?? {})
    const labelOf = (className: string) => {
      const piece = pieces.find((p) => p.className === className)
      return piece === undefined ? className : pieceLabelOf(piece)
    }
    return {
      rejected: classes.rejected.map(labelOf),
      // a surface or mirror flag on a piece no 0.4.1 save has shown with one
      unverified: [...classes.unverified, ...unconfirmedPropertiesIn(items, pieces)]
    }
  }, [items, catalog])
  const savedCreator = usableCreatorName(useCreator())
  const mapCreator = levelData.creatorName.trim()
  // Only Settings › General sets a creator. Save gives the map that one; Rename and Duplicate keep the map's own, unless
  // it has none a file name can hold. "" when there is no creator to use.
  const creator = mode === "saveAs" || !isValidName(mapCreator) ? savedCreator : mapCreator
  const taken = useMemo(() => new Set(projectMaps.map((m) => m.fileName)), [projectMaps])
  // a copy: a new draft is one too
  const copies = mode === "duplicate" || mode === "newDraft"
  const startName = () =>
    copies ? copyNameOf(levelData.levelDisplayName.trim(), creator, taken) : levelData.levelDisplayName
  const [name, setName] = useState(startName)
  // Each time the dialog opens, start from the map as it is now.
  useOnOpen(open, () => {
    setName(startName())
    newProject.reset()
  })

  const trimmed = name.trim()
  const target = mapFileNameOf(trimmed, creator)
  const clash = projects && target !== fileName && taken.has(target)
  // Duplicate may write over another map (it goes to the backups); Rename and Save never do.
  const replaces = clash && copies
  const submit = async () => {
    // a project main refuses leaves the dialog up, so its name or folder can be changed
    if (namesProject && (await canMakeProject(newProject.project)) !== true) return
    onClose()
    if (mode === "duplicate") await duplicateMap(trimmed, creator, replaces)
    else if (mode === "newDraft") await playAsNewDraft(trimmed, creator, replaces)
    else if (mode === "rename") await renameOpenMap(trimmed, creator)
    else {
      useEditor.getState().renameLevel(trimmed, creator)
      await (namesProject ? saveMapInNewProject(newProject.project, afterSave) : saveMapAs(afterSave))
    }
  }

  const copy = {
    saveAs: projects
      ? { title: "Save map", submit: "Save" }
      : { title: "Export map", note: "Put the file in the game's maps folder and keep its name.", submit: "Download" },
    rename: { title: "Rename map", submit: "Rename" },
    duplicate: { title: "Duplicate map", note: "You'll go on editing the copy.", submit: "Duplicate" },
    newDraft: {
      title: "Play a new draft",
      note: "Play can't race a published map, so it races a copy.",
      submit: "Save and play"
    }
  }[mode]
  const { unverified } = risky

  return (
    <MapNameDialog
      open={open}
      onClose={onClose}
      id={mode}
      title={copy.title}
      {...(copy.note !== undefined && { description: copy.note })}
      name={name}
      onNameChange={setName}
      nameNote={replaces
        ? <span className={WARNING}>Already in the project. Replacing keeps the old one in the backups.</span>
        : clash && <span className={ERROR}>The project already has a map called {trimmed}.</span>}
      submitLabel={replaces ? "Replace" : copy.submit}
      submitReplaces={replaces}
      canSubmit={isValidName(trimmed) && isValidName(creator) && risky.rejected.length === 0 &&
        (!clash || replaces) && (!namesProject || newProject.ok)}
      onSubmit={submit}
    >
      {namesProject && <NewProjectFields draft={newProject} />}
      {creator === "" && (
        <div className="flex items-center justify-between gap-2">
          <span className={ERROR}>Set your creator name first.</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => openDialog({ id: "settings", category: "general" })}
          >
            Open Settings
          </Button>
        </div>
      )}
      {risky.rejected.length > 0 && (
        <p className={ERROR}>The game rejects {risky.rejected.join(", ")}. Remove them first.</p>
      )}
      {unverified.length > 0 && (
        <Tooltip>
          <TooltipTrigger render={<p className={WARNING} />}>
            {unverified.length === 1 ? "1 piece isn't" : `${unverified.length} pieces aren't`}{" "}
            confirmed to load in game.
          </TooltipTrigger>
          <TooltipContent side="bottom">
            If the game rejects one, it discards the whole map, so test with a copy: {unverified.join(", ")}
          </TooltipContent>
        </Tooltip>
      )}
    </MapNameDialog>
  )
}
