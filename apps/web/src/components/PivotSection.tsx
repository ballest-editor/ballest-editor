import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { useShallow } from "zustand/react/shallow"
import { PIVOT_CHOICES, pivotBoundsOf } from "../domain/pivot"
import { setSelectionPivot } from "../editor/actions"
import { pivotOf, useEditor } from "../editor/store"
import { InfoHint } from "./InfoHint"
import { SectionTitle } from "./SectionTitle"

/**
 * A toggle's look when it's on (pressed), or on for only part of a mixed selection (`data-in-use`): a lighter surface,
 * never the primary colour, which is for the one action a view is asking for.
 */
export const TOGGLE_STATE_CLASSES =
  "text-fg-secondary aria-pressed:bg-foreground/15 aria-pressed:text-foreground data-[in-use]:ring-1 data-[in-use]:ring-foreground/40 data-[in-use]:ring-inset"

/**
 * The selection's pivot: the game's choices as one segmented control, four to a row. A click
 * sets the choice on every selected item. When their pivots differ, nothing is pressed and the
 * choices in use are outlined. Choices other than Default need the piece's bounds, so they're
 * off for pieces without them.
 */
export function PivotSection() {
  const choices = useEditor(useShallow((s) => s.selectedIds.map((id) => pivotOf(s, id).choice)))
  const allBounded = useEditor((s) =>
    s.selectedIds.every((id) => {
      const item = s.doc.map.items[s.doc.ids.indexOf(id)]
      return item !== undefined && pivotBoundsOf(item, s.catalogIndex) !== undefined
    })
  )
  const used = new Set(choices)
  const mixed = used.size > 1
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Pivot</SectionTitle>
        {mixed && <div className="text-caption text-fg-tertiary">Mixed</div>}
        {!allBounded && <InfoHint>This piece's bounds are unknown, so only Default is available.</InfoHint>}
      </div>
      <ToggleGroup
        aria-label="Pivot"
        value={mixed ? [] : choices.slice(0, 1)}
        onValueChange={(value) => {
          const next = PIVOT_CHOICES.find((c) => value.includes(c))
          if (next !== undefined) setSelectionPivot(next) // clicking the pressed choice keeps it
        }}
        spacing={0}
        className="grid w-full grid-cols-4 gap-px overflow-hidden border border-input bg-input"
      >
        {PIVOT_CHOICES.map((choice) => (
          <ToggleGroupItem
            key={choice}
            value={choice}
            disabled={choice !== "Default" && !allBounded}
            data-in-use={mixed && used.has(choice) ? "" : undefined}
            className={cn(
              "min-w-0 rounded-none! bg-card px-1! focus-visible:ring-2 focus-visible:ring-inset",
              TOGGLE_STATE_CLASSES
            )}
          >
            {choice}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
