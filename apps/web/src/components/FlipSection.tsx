import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type PlacedItem, selectionFlip } from "../domain/itemProperties"
import type { FlipAxis } from "../domain/mirror"
import { flipSelection } from "../editor/actions"
import { FieldRow } from "./InspectorLayout"
import { IN_USE_CLASSES } from "./PivotSection"

/** The game's labels and help text (its strings table: `FlipXLabel`, `FlipXHelp`, ...). */
const FLIPS: ReadonlyArray<{ readonly axis: FlipAxis; readonly label: string; readonly help: string }> = [
  { axis: "x", label: "Flip X", help: "Flip each selected item along its local X (red) axis." },
  { axis: "y", label: "Flip Y", help: "Flip each selected item along its local Y (green) axis." }
]

/**
 * The selection's flips, a small segmented pair under the transform, either or both on. A click flips each
 * selected item from its own state, so a mixed selection stays mixed. Unlike the game, which
 * shows no state, these show what's flipped. A selection that can't flip at all (the player
 * start, the goal, the checkpoints) has no row, as in the game.
 */
export function FlipSection({ items }: { readonly items: ReadonlyArray<PlacedItem> }) {
  const flips = FLIPS.map((flip) => ({ ...flip, state: selectionFlip(items, flip.axis) }))
  if (flips.every(({ state }) => state === "unavailable")) return null
  return (
    <FieldRow label="Flip">
      <ToggleGroup
        aria-label="Flip"
        multiple
        value={flips.filter(({ state }) => state === "on").map(({ axis }) => axis)}
        onValueChange={(value) => {
          const changed = flips.find(({ axis, state }) => value.includes(axis) !== (state === "on"))
          if (changed !== undefined) flipSelection(changed.axis)
        }}
      >
        {flips.map(({ axis, label, help, state }) => {
          const unavailable = state === "unavailable"
          return (
            <Tooltip key={axis}>
              {/* The trigger is out here because a disabled button takes no pointer events. */}
              <TooltipTrigger render={<span className="inline-flex" />}>
                <ToggleGroupItem
                  value={axis}
                  aria-label={label}
                  disabled={unavailable}
                  data-in-use={state === "mixed" ? "" : undefined}
                  className={cn("uppercase", IN_USE_CLASSES)}
                >
                  {axis}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent side="left">
                {unavailable ? `${label} doesn't apply to this selection.` : help}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </ToggleGroup>
    </FieldRow>
  )
}
