import { useMemo, useState } from "react"
import { riskyClassesIn } from "../domain/Catalog"
import { copyNameOf, isValidName, mapFileNameOf } from "../domain/factory"
import { classNameOf } from "../domain/MapFile"
import { duplicateMap, renameOpenMap, saveMapAs } from "../editor/actions"
import { useEditor } from "../editor/store"
import { type MapCreator, MapNameDialog, useMapCreator } from "./MapNameDialog"

/**
 * Names the open map before it is written: `saveAs` for a map that has no file yet (desktop: into the project) or for
 * a browser's Export (a download); `rename` and `duplicate` from the Map menu. Every mode confirms the name, so a file
 * never disagrees with the names inside it (the game refuses to load those).
 */
export type NameMapMode = "saveAs" | "rename" | "duplicate"

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
  const projectName = useEditor((s) => s.project?.current.name ?? "the project")
  const projectMaps = useEditor((s) => s.projectMaps)
  const fileName = useEditor((s) => s.file?.name ?? null)
  const risky = useMemo(
    () =>
      riskyClassesIn(
        items.map((it) => classNameOf(it.actorToSpawn)),
        catalog?.catalog.pieces ?? [],
        catalog?.verified ?? {}
      ),
    [items, catalog]
  )
  const settingsCreator = useMapCreator()
  const mapCreator = levelData.creatorName.trim()
  const ownCreator = useOwnCreator(mapCreator || settingsCreator.name)
  const creator = mode === "saveAs" ? settingsCreator : ownCreator
  const taken = useMemo(() => new Set(projectMaps.map((m) => m.fileName)), [projectMaps])
  const startName = () =>
    mode === "duplicate"
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
  const submit = async () => {
    await creator.persist()
    onClose()
    if (mode === "duplicate") await duplicateMap(name, creator.name)
    else if (mode === "rename") await renameOpenMap(name, creator.name)
    else {
      useEditor.getState().renameLevel(name, creator.name)
      await saveMapAs()
    }
  }

  const copy = {
    saveAs: projects
      ? { title: "Save map", note: `Saves it in ${projectName}.`, submit: "Save" }
      : {
        title: "Export map",
        note: "Downloads it. Drop it in the game's UserSavedMaps folder; don't rename the file afterwards.",
        submit: "Download"
      },
    rename: {
      title: "Rename map",
      note: "The map's file in the project moves to the new name; the old one goes to the project's backups.",
      submit: "Rename"
    },
    duplicate: {
      title: "Duplicate map",
      note:
        "Saves a copy of the map as it is now in the project, and goes on editing the copy. The original keeps its last save.",
      submit: "Duplicate"
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
            onClick={() => openDialog("settings", "general")}
          >
            change
          </button>
        </div>
      }
      submitLabel={copy.submit}
      canSubmit={isValidName(name) && isValidName(creator.name) && risky.rejected.length === 0 && !clash}
      onSubmit={submit}
    >
      {clash && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          The project already has a map called {name.trim()} by {creator.name}.
        </p>
      )}
      {risky.rejected.length > 0 && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          The in-game editor rejects {risky.rejected.join(", ")} and will discard the whole map. Remove them first.
        </p>
      )}
      {risky.unverified.length > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Not yet confirmed to load in-game:{" "}
          {risky.unverified.join(", ")}. If the game rejects one, it discards the whole map — test with a copy.
        </p>
      )}
    </MapNameDialog>
  )
}
