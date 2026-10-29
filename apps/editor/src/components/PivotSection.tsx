import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { useShallow } from "zustand/react/shallow"
import { PIVOT_CHOICES, pivotBoundsOf, type PivotChoice } from "../domain/pivot"
import { setSelectionPivot } from "../editor/actions"
import { pivotOf, useEditor } from "../editor/store"
import { SectionTitle } from "./SectionTitle"

/** The game's layout: Default alone, then Center | Bottom, Top | Left | Right, Back | Front (6 columns). */
const span: Record<PivotChoice, string> = {
  Default: "col-span-6",
  Center: "col-span-3",
  Bottom: "col-span-3",
  Top: "col-span-2",
  Left: "col-span-2",
  Right: "col-span-2",
  Back: "col-span-3",
  Front: "col-span-3"
}

/**
 * The selection's pivot, like the game's inspector. A click sets the choice on every selected
 * item. When their pivots differ, nothing is pressed and the choices in use are outlined.
 * Choices other than Default need the piece's bounds, so they're off for pieces without them.
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
      <div className="flex items-baseline justify-between">
        <SectionTitle>Pivot</SectionTitle>
        {mixed && <div className="text-xs text-muted-foreground">Mixed</div>}
      </div>
      <ToggleGroup
        aria-label="Pivot"
        value={mixed ? [] : choices.slice(0, 1)}
        onValueChange={(value) => {
          const next = PIVOT_CHOICES.find((c) => value.includes(c))
          if (next !== undefined) setSelectionPivot(next) // clicking the pressed choice keeps it
        }}
        spacing={1}
        variant="outline"
        size="sm"
        className="grid w-full grid-cols-6"
      >
        {PIVOT_CHOICES.map((choice) => {
          const disabled = choice !== "Default" && !allBounded
          return (
            <ToggleGroupItem
              key={choice}
              value={choice}
              disabled={disabled}
              title={disabled ? "This piece's bounds are unknown, so only Default is available." : undefined}
              data-in-use={mixed && used.has(choice) ? "" : undefined}
              className={`${
                span[choice]
              } data-[in-use]:border-primary data-[in-use]:bg-primary/15 data-[pressed]:border-primary data-[pressed]:bg-primary data-[pressed]:text-primary-foreground`}
            >
              {choice}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
    </div>
  )
}
