import { Toggle } from "@workspace/ui/components/toggle"
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
 * The selection's flips, side by side under the transform like the game's inspector. A click
 * flips each selected item from its own state, so a mixed selection stays mixed. Unlike the
 * game, which shows no state and leaves the buttons live on pieces they do nothing to, these
 * show what's flipped, Flip Y is off for a physics prop, and a selection that can't flip at all
 * has no row (the game hides it for the player start only).
 */
export function FlipSection({ items }: { readonly items: ReadonlyArray<PlacedItem> }) {
  const flips = FLIPS.map((flip) => ({ ...flip, state: selectionFlip(items, flip.axis) }))
  if (flips.every(({ state }) => state === "unavailable")) return null
  return (
    <div className="grid grid-cols-2 gap-1">
      {flips.map(({ axis, label, help, state }) => {
        const unavailable = state === "unavailable"
        return (
          // The title is out here because a disabled button takes no pointer events.
          <div key={axis} title={unavailable ? `${label} doesn't apply to this selection.` : help}>
            <Toggle
              variant="outline"
              size="sm"
              pressed={state === "on"}
              disabled={unavailable}
              onPressedChange={() => flipSelection(axis)}
              data-in-use={state === "mixed" ? "" : undefined}
              className={`w-full ${TOGGLE_STATE_CLASSES}`}
            >
              {label}
            </Toggle>
          </div>
        )
      })}
    </div>
  )
}
