import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useMemo, useState } from "react"
import { riskyClassesIn } from "../domain/Catalog"
import { copyNameOf, isValidName, mapFileNameOf } from "../domain/factory"
import { unconfirmedPropertiesIn } from "../domain/itemProperties"
import { classNameOf } from "../domain/MapFile"
import { isProjectName } from "../domain/project"
import { duplicateMap, nameProject, playAsNewDraft, renameOpenMap, saveMapAs } from "../editor/actions"
import { useEditor } from "../editor/store"
import { type MapCreator, MapNameDialog, useMapCreator } from "./MapNameDialog"
import { PathText } from "./PathText"

/**
 * Names the open map before it is written: `saveAs` for a map that has no file yet (desktop: into the project) or for
 * a browser's Export (a download); `rename` and `duplicate` from the Project menu; `newDraft`, Play's way out for a
 * published map's draft (the plugin manager races only maps never published): a duplicate that isn't linked to the
 * Workshop item, raced once it is saved. Every mode confirms the name, so a file never disagrees with the names inside
 * it (the game refuses to load those).
 */
export type NameMapMode = "saveAs" | "rename" | "duplicate" | "newDraft"

/** The map's own creator, editable: Rename and Duplicate may change it. */
const useOwnCreator = (initial: string): MapCreator => {
  const [draft, setDraft] = useState(initial)
  return { saved: "", draft, setDraft, name: draft.trim(), persist: () => Promise.resolve() }
}

export function NameMapDialog(
  { mode, open, onClose }: { readonly mode: NameMapMode; readonly open: boolean; readonly onClose: () => void }
) {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const openDialog = useEditor((s) => s.openDialog)
  const items = useEditor((s) => s.doc.map.items)
  const catalog = useEditor((s) => s.catalog)
  const projects = useEditor((s) => s.capabilities.projects)
  const project = useEditor((s) => s.project?.current ?? null)
  const projectsFolder = useEditor((s) => s.project?.projectsFolder ?? "")
  // Saving into Untitled Project names the project first (docs/PROJECTS.md § Shell)
  const namesProject = projects && mode === "saveAs" && project === null
  const [projectDraft, setProjectDraft] = useState("")
  const projectTrimmed = projectDraft.trim()
  const projectOk = !namesProject || isProjectName(projectTrimmed)
  const projectMaps = useEditor((s) => s.projectMaps)
  const fileName = useEditor((s) => s.file?.name ?? null)
  // What the unsaved-changes prompt's Save (or Export, Play) goes on to do once the map is saved (close, a new map...):
  // Submit holds on to it as it closes the dialog, then saves; Cancel drops it with the dialog.
  const afterSave = useEditor((s) => s.dialog?.id === "saveAs" ? s.dialog.afterSave : undefined)
  const risky = useMemo(() => {
    const pieces = catalog?.catalog.pieces ?? []
    const classes = riskyClassesIn(items.map((it) => classNameOf(it.actorToSpawn)), pieces, catalog?.verified ?? {})
    // a surface or mirror flag on a piece no 0.4.1 save has shown with one
    return { ...classes, unverified: [...classes.unverified, ...unconfirmedPropertiesIn(items, pieces)] }
  }, [items, catalog])
  const settingsCreator = useMapCreator()
  const mapCreator = levelData.creatorName.trim()
  const ownCreator = useOwnCreator(mapCreator || settingsCreator.name)
  const creator = mode === "saveAs" ? settingsCreator : ownCreator
  const taken = useMemo(() => new Set(projectMaps.map((m) => m.fileName)), [projectMaps])
  // a copy: a new draft is one too
  const copies = mode === "duplicate" || mode === "newDraft"
  const startName = () =>
    copies
      ? copyNameOf(levelData.levelDisplayName.trim(), mapCreator || settingsCreator.name, taken)
      : levelData.levelDisplayName
  const [name, setName] = useState(startName)
  // Each time the dialog opens, start from the map as it is now.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(startName())
      ownCreator.setDraft(mapCreator || settingsCreator.name)
    }
  }

  const target = mapFileNameOf(name.trim(), creator.name)
  const clash = projects && target !== fileName && taken.has(target)
  // Duplicate may write over another map (it goes to the backups); Rename and Save never do.
  const replaces = clash && copies
  const submit = async () => {
    await creator.persist()
    onClose()
    if (mode === "duplicate") await duplicateMap(name, creator.name, replaces)
    else if (mode === "newDraft") await playAsNewDraft(name, creator.name, replaces)
    else if (mode === "rename") await renameOpenMap(name, creator.name)
    else {
      if (namesProject) await nameProject(projectTrimmed)
      useEditor.getState().renameLevel(name, creator.name)
      await saveMapAs(afterSave)
    }
  }

  const copy = {
    saveAs: projects
      ? namesProject
        ? { title: "Save map", note: "Names the project it goes in and saves it there.", submit: "Save" }
        : { title: "Save map", note: `Saves it in ${project?.name ?? "the project"}.`, submit: "Save" }
      : {
        title: "Export map",
        note: "Downloads it. Put it in the game's UserSavedMaps folder; don't rename the file.",
        submit: "Download"
      },
    rename: {
      title: "Rename map",
      note: "The file moves to the new name; the old one goes to the backups.",
      submit: "Rename"
    },
    duplicate: {
      title: "Duplicate map",
      note: "Saves a copy of the map as it is now and goes on editing the copy. The original keeps its last save.",
      submit: "Duplicate"
    },
    newDraft: {
      title: "Play a new draft",
      note: "Saves a copy as a new draft, goes on editing it and races it. The published draft keeps its last save.",
      submit: "Save and play"
    }
  }[mode]

  return (
    <MapNameDialog
      open={open}
      onClose={onClose}
      id={mode}
      title={copy.title}
      fileNameLead="Exports as"
      fileNameNote={copy.note}
      name={name}
      onNameChange={setName}
      creator={creator}
      {...(mode !== "saveAs" && { creatorHint: "The map's creator; Settings › General keeps the one new maps get." })}
      savedCreator={
        <div className="text-xs text-muted-foreground">
          Creator: <span className="text-foreground">{creator.saved}</span>{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => openDialog({ id: "settings", category: "general" })}
          >
            change
          </button>
        </div>
      }
      submitLabel={replaces ? "Replace" : copy.submit}
      canSubmit={isValidName(name) && isValidName(creator.name) && risky.rejected.length === 0 &&
        (!clash || replaces) && projectOk}
      onSubmit={submit}
    >
      {namesProject && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="saveAs-project">Project name</Label>
          <Input
            id="saveAs-project"
            value={projectDraft}
            placeholder="My tracks"
            aria-invalid={projectTrimmed !== "" && !projectOk}
            onChange={(e) => setProjectDraft(e.target.value)}
          />
          <div className="text-[0.7rem] text-muted-foreground">
            {projectTrimmed !== "" && !projectOk
              ? "Letters, digits, spaces, - and _ only."
              : (
                <PathText block>
                  {projectTrimmed === "" ? projectsFolder : `${projectsFolder}/${projectTrimmed}`}
                </PathText>
              )}
          </div>
        </div>
      )}
      {mode === "newDraft" && (
        <p className="text-xs text-muted-foreground">
          {levelData.levelDisplayName} is the draft of a Workshop map (item{" "}
          {levelData.levelPublishedFileId}). The plugin manager races only maps never published, so Play races a copy
          under another name, not linked to the Workshop item.
        </p>
      )}
      {replaces && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          The project already has {name.trim()} by {creator.name}. {mode === "newDraft" ? "Save and play" : "Duplicate"}
          {" "}
          replaces it; the current file goes to the backups.
        </p>
      )}
      {clash && !replaces && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          The project already has {name.trim()} by {creator.name}.
        </p>
      )}
      {risky.rejected.length > 0 && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          The game rejects {risky.rejected.join(", ")} and would discard the whole map. Remove them first.
        </p>
      )}
      {risky.unverified.length > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Not yet confirmed to load in-game:{" "}
          {risky.unverified.join(", ")}. If the game rejects one, it discards the whole map. Test with a copy.
        </p>
      )}
    </MapNameDialog>
  )
}
