import { useState } from "react"
import { isValidName } from "../domain/factory"
import { newMap } from "../editor/actions"
import { MapNameDialog, useMapCreator } from "./MapNameDialog"

export function NewMapDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const creator = useMapCreator()
  const [name, setName] = useState("")
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
      fileNameNote="Starts like a new in-game map, with the player start and the goal ring where the game puts them. Unsaved changes in the current map are discarded."
      name={name}
      onNameChange={setName}
      creator={creator}
      submitLabel="Create"
      canSubmit={isValidName(name) && isValidName(creator.name)}
      onSubmit={submit}
    />
  )
}
