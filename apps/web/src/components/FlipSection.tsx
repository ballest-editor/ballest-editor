import { Toggle } from "@workspace/ui/components/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type PlacedItem, selectionFlip } from "../domain/itemProperties"
import type { FlipAxis } from "../domain/mirror"
import { flipSelection } from "../editor/actions"
import { TOGGLE_STATE_CLASSES } from "./PivotSection"

/** The game's labels and help text (its strings table: `FlipXLabel`, `FlipXHelp`, ...). */
const FLIPS: ReadonlyArray<{ readonly axis: FlipAxis; readonly label: string; readonly help: string }> = [
  { axis: "x", label: "Flip X", help: "Flip each selected item along its local X (red) axis." },
  { axis: "y", label: "Flip Y", help: "Flip each selected item along its local Y (green) axis." }
]

/**
 * The selection's flips, a small pair of toggles under the transform. A click flips each
 * selected item from its own state, so a mixed selection stays mixed. Unlike the game, which
 * shows no state, these show what's flipped. A selection that can't flip at all (the player
 * start, the goal, the checkpoints) has no row, as in the game.
 */
export function FlipSection({ items }: { readonly items: ReadonlyArray<PlacedItem> }) {
  const flips = FLIPS.map((flip) => ({ ...flip, state: selectionFlip(items, flip.axis) }))
  if (flips.every(({ state }) => state === "unavailable")) return null
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-body text-fg-secondary">Flip</span>
      <div className="flex gap-1">
        {flips.map(({ axis, label, help, state }) => {
          const unavailable = state === "unavailable"
          return (
            <Tooltip key={axis}>
              {/* The trigger is out here because a disabled button takes no pointer events. */}
              <TooltipTrigger render={<span />}>
                <Toggle
                  variant="outline"
                  aria-label={label}
                  pressed={state === "on"}
                  disabled={unavailable}
                  onPressedChange={() => flipSelection(axis)}
                  data-in-use={state === "mixed" ? "" : undefined}
                  className={cn("uppercase", TOGGLE_STATE_CLASSES)}
                >
                  {axis}
                </Toggle>
              </TooltipTrigger>
              <TooltipContent side="left">
                {unavailable ? `${label} doesn't apply to this selection.` : help}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
