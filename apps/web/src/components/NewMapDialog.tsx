import { useState } from "react"
import { isValidName, mapFileNameOf } from "../domain/factory"
import { newMap } from "../editor/actions"
import { useEditor } from "../editor/store"
import { MapNameDialog, useMapCreator } from "./MapNameDialog"

/** New map: the name (and creator) is all it asks; on desktop the map is saved into the project at once. */
export function NewMapDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const creator = useMapCreator()
  const projects = useEditor((s) => s.capabilities.projects)
  const projectName = useEditor((s) => s.project?.current.name ?? "the project")
  const [name, setName] = useState("")
  const clash = useEditor((s) =>
    projects && s.projectMaps.some((m) => m.fileName === mapFileNameOf(name.trim(), creator.name))
  )
  const submit = async () => {
    await creator.persist()
    await newMap(name, creator.name)
    setName("")
    onClose()
  }
  return (
    <MapNameDialog
      open={open}
      onClose={onClose}
      id="new"
      title="New map"
      fileNameLead="Exports as"
      fileNameNote={`Starts like a new in-game map, with the player start and the goal ring where the game puts them${
        projects ? `, and is saved in ${projectName} at once` : ""
      }.`}
      name={name}
      onNameChange={setName}
      creator={creator}
      submitLabel="Create"
      canSubmit={isValidName(name) && isValidName(creator.name) && !clash}
      onSubmit={submit}
    >
      {clash && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          The project already has a map called {name.trim()} by{" "}
          {creator.name}. Open it from File › Open map, or pick another name.
        </p>
      )}
    </MapNameDialog>
  )
}
