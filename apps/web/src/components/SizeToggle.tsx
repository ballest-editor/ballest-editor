import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { gizmoSizes } from "../domain/Settings"

type Size = typeof gizmoSizes[number]

/** Small, medium or large, for a gizmo. Clicking the pressed size keeps it. */
export function SizeToggle({ label, value, onChange }: {
  readonly label: string
  readonly value: Size
  readonly onChange: (size: Size) => void
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(picked) => {
        const next = gizmoSizes.find((choice) => picked.includes(choice))
        if (next !== undefined) onChange(next)
      }}
    >
      {gizmoSizes.map((choice) => (
        <ToggleGroupItem key={choice} value={choice} className="min-w-8 uppercase">{choice}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
