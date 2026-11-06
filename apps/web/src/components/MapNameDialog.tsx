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
import type { ReactNode } from "react"
import { isValidName, NAME_RULE_SENTENCE } from "../domain/factory"

/**
 * The one-field form shared by Save, Rename, Duplicate and Export. The file name comes from this name and the creator
 * (`mapFileNameOf`), but it is the game's business, so the form doesn't show it. The rule shows only once it is broken.
 */
export function MapNameDialog(props: {
  readonly open: boolean
  readonly onClose: () => void
  /** Prefix for the input's id. */
  readonly id: string
  readonly title: string
  /** One line under the title, for a dialog that needs it. */
  readonly description?: string
  readonly name: string
  readonly onNameChange: (name: string) => void
  /** Under the field while the name keeps the rule: what is wrong with it otherwise. */
  readonly nameNote?: ReactNode
  /** Extra content above the buttons. */
  readonly children?: ReactNode
  readonly submitLabel: string
  /** Submit writes over another map: it looks like the other dialogs' Replace. */
  readonly submitReplaces?: boolean
  readonly canSubmit: boolean
  readonly onSubmit: () => Promise<void>
}) {
  const trimmed = props.name.trim()
  const breaksRule = trimmed !== "" && !isValidName(trimmed)
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
            {props.description !== undefined && <DialogDescription>{props.description}</DialogDescription>}
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${props.id}-name`}>Map name</Label>
            <Input
              id={`${props.id}-name`}
              autoFocus
              // a name is usually replaced whole: Untitled 2, or a copy's
              onFocus={(e) => e.currentTarget.select()}
              value={props.name}
              onChange={(e) => props.onNameChange(e.target.value)}
              aria-invalid={breaksRule}
            />
            {breaksRule ? <span className="text-body text-destructive">{NAME_RULE_SENTENCE}.</span> : props.nameNote}
          </div>
          {props.children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>Cancel</Button>
            <Button
              type="submit"
              variant={props.submitReplaces ? "destructive" : "default"}
              disabled={!props.canSubmit}
            >
              {props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
