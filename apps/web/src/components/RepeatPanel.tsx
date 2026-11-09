import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { LIMITS } from "../domain/limits"
import { isPlayerStart } from "../domain/MapFile"
import { defaultRepeat, repeatCopies, type RepeatOptions, repeatProblem } from "../domain/repeat"
import { repeatSelection } from "../editor/actions"
import { useEditor } from "../editor/store"
import { NumberField } from "./NumberField"
import { SURFACE } from "./viewControlStyle"

const AXES = ["x", "y", "z"] as const

/** Repeats the selected items as a grid in the game's world axes. */
export function RepeatPanel() {
  const [options, setOptions] = useState<RepeatOptions>(defaultRepeat)
  const selected = useEditor((s) =>
    s.selectedIds.filter((id) => {
      const item = s.doc.map.items[s.doc.ids.indexOf(id)]
      return item !== undefined && !isPlayerStart(item)
    }).length
  )
  const total = useEditor((s) => s.doc.map.items.length)
  const added = repeatCopies(options) * selected
  const problem = repeatProblem(options)
    ?? (selected === 0 ? "Select items to repeat. The player start cannot be copied." : undefined)
    ?? (total + added > LIMITS.itemsPerLevel ? "This repeat exceeds the map's item limit." : undefined)
  const update = (field: keyof RepeatOptions, axis: typeof AXES[number], value: number) =>
    setOptions((current) => ({ ...current, [field]: { ...current[field], [axis]: value } }))

  return (
    <section
      aria-label="Repeat options"
      data-repeat-panel
      className={cn(
        SURFACE,
        "pointer-events-auto flex max-h-full w-80 max-w-[calc(100%-1.5rem)] flex-col gap-3 overflow-auto rounded-2xl p-3"
      )}
    >
      <div className="text-body font-medium">Repeat selection</div>
      <p className="text-xs text-fg-secondary">World axes · Counts include the original · Spacing in cm</p>
      <div className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-2">
        <span className="text-xs text-fg-secondary">Axis</span>
        <span className="text-xs text-fg-secondary">Count</span>
        <span className="text-xs text-fg-secondary">Spacing</span>
        {AXES.map((axis) => (
          <AxisRow
            key={axis}
            axis={axis}
            count={options.count[axis]}
            spacing={options.spacing[axis]}
            update={update}
          />
        ))}
      </div>
      <p className="text-xs text-fg-secondary" role="status">
        {problem ?? (added === 0 ? "Enable an axis to repeat." : `Adds ${added.toLocaleString()} items.`)}
      </p>
      <Button
        tabIndex={-1}
        disabled={problem !== undefined || added === 0}
        onClick={(e) => {
          repeatSelection(options)
          e.currentTarget.blur()
        }}
      >
        Repeat
      </Button>
    </section>
  )
}

function AxisRow({ axis, count, spacing, update }: {
  readonly axis: typeof AXES[number]
  readonly count: number
  readonly spacing: number
  readonly update: (field: keyof RepeatOptions, axis: typeof AXES[number], value: number) => void
}) {
  const label = axis.toUpperCase()
  return (
    <>
      <Button
        tabIndex={-1}
        variant={count > 1 ? "secondary" : "ghost"}
        size="sm"
        aria-label={`Repeat on ${label}`}
        aria-pressed={count > 1}
        onClick={(e) => {
          update("count", axis, count > 1 ? 1 : 2)
          e.currentTarget.blur()
        }}
      >
        {label}
      </Button>
      <NumberField
        label={`${label} count`}
        value={count}
        digits={0}
        handle={false}
        onCommit={(v) => update("count", axis, Math.max(1, Math.round(v)))}
      />
      <NumberField
        label={`${label} spacing`}
        value={spacing}
        handle={false}
        unit="cm"
        onCommit={(v) => update("spacing", axis, v)}
      />
    </>
  )
}
