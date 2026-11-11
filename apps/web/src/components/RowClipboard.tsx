import { IconClipboard, IconCopy } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useState } from "react"
import type { Vec3 } from "../domain/coords"
import type { TransformField } from "../domain/groupTransform"
import { useEditor } from "../editor/store"
import { ShiftClick } from "./KeyChip"

/** What a row's three values are: a transform field, a size, or a pivot's position. Each keeps its own copy. */
export type ClipKey = TransformField | "size" | "pivot"

/** Copied rows in stored units (cm, degrees, factor; a size in cm), shared by every selection and tab. */
const copiedRows = new Map<ClipKey, Vec3>()

/**
 * A row's clipboard button: its menu, or Shift+click shortcuts, copies the row's three values and pastes a copy of the
 * same kind of row. What a paste does is the row's to say (`onPaste`): the row's three values typed, so every selected
 * thing takes them, each one whole.
 */
export function RowClipboard({ clipKey, label, value, onPaste }: {
  readonly clipKey: ClipKey
  /** The row's name, as shown. */
  readonly label: string
  /** What a copy reads: the row's values in stored units. */
  readonly value: Vec3
  readonly onPaste: (value: Vec3) => void
}) {
  const notify = useEditor((s) => s.notify)
  const [open, setOpen] = useState(false)
  const rowName = label.toLowerCase()
  const copy = () => {
    copiedRows.set(clipKey, value)
    notify("info", `Copied ${rowName}.`)
  }
  const paste = () => {
    const copied = copiedRows.get(clipKey)
    if (copied === undefined) notify("info", `Nothing copied for ${rowName} yet.`)
    else onPaste(copied)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // Shift+click pastes instead of opening the menu
        if (next && details.event instanceof MouseEvent && details.event.shiftKey) return
        setOpen(next)
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-fg-tertiary"
                  aria-label={`Copy or paste ${rowName}`}
                  onClick={(e) => {
                    if (e.shiftKey) paste()
                  }}
                  onContextMenu={(e) => {
                    if (!e.shiftKey) return
                    e.preventDefault()
                    copy()
                  }}
                />
              }
            />
          }
        >
          <IconClipboard />
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8} className="flex flex-col items-start py-2 pr-3 pl-2.5">
          <div className="text-body-strong">Copy / paste axis values</div>
          <div className="mt-1.5 grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-1 opacity-80">
            <span>Copy</span>
            <ShiftClick button="right" />
            <span>Paste</span>
            <ShiftClick button="left" />
          </div>
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="left" align="start" className="w-auto gap-1 p-1">
        <div className="px-2 py-1 text-body text-fg-secondary">{label}</div>
        <Button
          variant="ghost"
          size="sm"
          className="justify-between gap-4"
          onClick={() => {
            copy()
            setOpen(false)
          }}
        >
          <span className="flex items-center gap-2">
            <IconCopy />Copy X, Y, Z
          </span>
          <ShiftClick button="right" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="justify-between gap-4"
          disabled={copiedRows.get(clipKey) === undefined}
          onClick={() => {
            paste()
            setOpen(false)
          }}
        >
          <span className="flex items-center gap-2">
            <IconClipboard />Paste
          </span>
          <ShiftClick button="left" />
        </Button>
      </PopoverContent>
    </Popover>
  )
}
