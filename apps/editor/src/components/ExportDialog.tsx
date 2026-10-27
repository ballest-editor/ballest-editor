import { useMemo, useState } from "react"
import { riskyClassesIn } from "../domain/Catalog"
import { isValidName } from "../domain/factory"
import { classNameOf } from "../domain/MapFile"
import { exportMap } from "../editor/actions"
import { useEditor } from "../editor/store"
import { MapNameDialog, useMapCreator } from "./MapNameDialog"

/**
 * Export always confirms the map name, so a renamed file never disagrees with the names
 * inside it (the game refuses to load those). The creator comes from Settings › General.
 */
export function ExportDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const displayName = useEditor((s) => s.doc.map.worldSettings.levelData.levelDisplayName)
  const renameLevel = useEditor((s) => s.renameLevel)
  const openDialog = useEditor((s) => s.openDialog)
  const items = useEditor((s) => s.doc.map.items)
  const catalog = useEditor((s) => s.catalog)
  const risky = useMemo(
    () =>
      riskyClassesIn(
        items.map((it) => classNameOf(it.actorToSpawn)),
        catalog?.catalog.pieces ?? [],
        catalog?.verified ?? {}
      ),
    [items, catalog]
  )
  const creator = useMapCreator()
  const [name, setName] = useState(displayName)
  // Each time the dialog opens, start from the map's current name.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setName(displayName)
  }
  const submit = async () => {
    await creator.persist()
    renameLevel(name, creator.name)
    onClose()
    await exportMap()
  }

  return (
    <MapNameDialog
      open={open}
      onClose={onClose}
      id="export"
      title="Export map"
      fileNameLead="Saves"
      fileNameNote="Drop it in the game's UserSavedMaps folder; don't rename the file afterwards."
      name={name}
      onNameChange={setName}
      creator={creator}
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
      submitLabel="Export"
      canSubmit={isValidName(name) && isValidName(creator.name) && risky.rejected.length === 0}
      onSubmit={submit}
    >
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
