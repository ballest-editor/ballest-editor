import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { type ReactNode, useState } from "react"
import { usableCreatorName } from "../domain/creator"
import { isValidName, mapFileNameOf, NAME_RULE } from "../domain/factory"
import { updateSettings } from "../editor/actions"
import { useCreator } from "../editor/store"

export interface MapCreator {
  /**
   * The creator in use: typed in Settings › General, else the one found (the Steam name). "" when there is none a map
   * can use, and the dialog asks.
   */
  readonly saved: string
  readonly draft: string
  readonly setDraft: (draft: string) => void
  /** The saved creator, else what was typed here. */
  readonly name: string
  /** Saves a typed creator to Settings › General (no-op when there already is one). */
  readonly persist: () => Promise<void>
}

export const useMapCreator = (): MapCreator => {
  const saved = usableCreatorName(useCreator())
  const [draft, setDraft] = useState("")
  const name = saved || draft.trim()
  const persist = async () => {
    if (saved === "") await updateSettings("general", { creatorName: name })
  }
  return { saved, draft, setDraft, name, persist }
}

/**
 * The name + creator form shared by New map and Export. Both names go into the file name
 * (`mapFileNameOf`), which the game checks against the names inside the file.
 */
export function MapNameDialog(props: {
  readonly open: boolean
  readonly onClose: () => void
  /** Prefix for the input ids. */
  readonly id: string
  readonly title: string
  /** Text before and after the file name in the description. */
  readonly fileNameLead: string
  readonly fileNameNote: ReactNode
  readonly name: string
  readonly onNameChange: (name: string) => void
  readonly creator: MapCreator
  /** Shown instead of the creator input when a creator is saved. */
  readonly savedCreator?: ReactNode
  /** Extra content above the buttons. */
  readonly children?: ReactNode
  readonly submitLabel: string
  readonly canSubmit: boolean
  readonly onSubmit: () => Promise<void>
}) {
  const { creator } = props
  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (props.canSubmit) void props.onSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>
              {props.fileNameLead}{" "}
              <code className="break-all">{mapFileNameOf(props.name || "name", creator.name || "creator")}</code>.{" "}
              {props.fileNameNote}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${props.id}-name`}>Map name</Label>
            <Input
              id={`${props.id}-name`}
              autoFocus
              value={props.name}
              onChange={(e) => props.onNameChange(e.target.value)}
              aria-invalid={props.name !== "" && !isValidName(props.name)}
            />
            <span className="text-[0.7rem] text-muted-foreground">{NAME_RULE}</span>
          </div>
          {creator.saved === ""
            ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${props.id}-creator`}>Creator (your in-game name)</Label>
                <Input
                  id={`${props.id}-creator`}
                  value={creator.draft}
                  onChange={(e) => creator.setDraft(e.target.value)}
                  aria-invalid={creator.draft !== "" && !isValidName(creator.name)}
                />
                <span className="text-[0.7rem] text-muted-foreground">Saved to Settings › General.</span>
              </div>
            )
            : props.savedCreator}
          {props.children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>Cancel</Button>
            <Button type="submit" disabled={!props.canSubmit}>{props.submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
