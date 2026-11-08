import { ColorSwatch } from "@workspace/ui/components/color-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { lookupMaterial, type MaterialTable } from "../domain/Materials"
import {
  choiceOf,
  colorForFinish,
  colorLabelOf,
  cssColor,
  finishLabelOf,
  materialLabelOf,
  type PaintPicker,
  shownFinishOf,
  swatchColor
} from "../domain/Paint"
import type { Surfaces } from "../domain/surface"
import { type Brush, paintHintOf } from "../editor/paintTarget"
import { currentBrush, useEditor } from "../editor/store"
import { FinishSwatches, SwatchButton } from "./PaintSection"
import { GROUP_DIVIDER, noFocus, releaseFocus, SURFACE } from "./viewControlStyle"

const capitalized = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`

/** A surface as the palette names it: "Ice surface", and "No surface" for none. */
const surfaceLabelOf = (surfaces: Surfaces, value: number): string => {
  const name = surfaces[value]?.name
  return value === 0 ? "No surface" : `${capitalized(name ?? String(value))} surface`
}

/** A surface's swatch colour: its material's; null for none. */
const surfaceColorOf = (surfaces: Surfaces, value: number, table: MaterialTable | null): string | null => {
  const material = surfaces[value]?.material ?? null
  return material === null ? null : cssColor(swatchColor(lookupMaterial(table, material)))
}

/** What the brush paints, as a person would say it, and its swatch colour (null: no surface). */
const brushLookOf = (
  brush: Brush,
  paint: PaintPicker,
  surfaces: Surfaces,
  table: MaterialTable | null
): { readonly label: string; readonly color: string | null } => {
  if (brush._tag === "Surface") {
    return { label: surfaceLabelOf(surfaces, brush.value), color: surfaceColorOf(surfaces, brush.value, table) }
  }
  const choice = choiceOf(paint, brush.material)
  return {
    label: choice === undefined
      ? materialLabelOf(brush.material)
      : `${finishLabelOf(choice.finish)} ${colorLabelOf(choice.color)}`,
    color: cssColor(swatchColor(lookupMaterial(table, brush.material), choice?.color.displayColor))
  }
}

/**
 * The paint tool's palette, over the tool bar while the tool is on: what a click paints (editor/paintTarget.ts). The
 * game's picker, a finish then its colours, as the Inspector's Paint has it, and the surfaces, which always cover a
 * whole piece. A change of finish keeps the colour when the new finish has it, as in the game; otherwise it only shows
 * that finish's colours until one is picked. Pointer-only, so keybinds stay with the viewport.
 */
export function PaintPalette() {
  const paint = useEditor((s) => s.paint)
  const surfaces = useEditor((s) => s.surfaces)
  const table = useEditor((s) => s.materialTable)
  const picked = useEditor((s) => s.brush)
  const setBrush = useEditor((s) => s.setBrush)
  const [browsing, setBrowsing] = useState<string | null>(null)
  const brush = currentBrush({ brush: picked, paint })
  if (brush === undefined) return null // the game's materials aren't loaded
  const choice = brush._tag === "Material" ? choiceOf(paint, brush.material) : undefined
  const finish = paint.find((f) => f.name === browsing) ?? shownFinishOf(paint, choice)
  const look = brushLookOf(brush, paint, surfaces, table)

  const pick = (next: Brush) => {
    setBrowsing(null)
    setBrush(next)
  }
  const changeFinish = (name: string | null) => {
    const next = paint.find((f) => f.name === name)
    if (next === undefined) return
    const color = colorForFinish(next, choice)
    if (color === undefined) setBrowsing(next.name)
    else pick({ _tag: "Material", material: color.material })
  }

  return (
    <div
      data-paint-palette
      className={cn(
        SURFACE,
        "pointer-events-auto flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl px-3 py-2"
      )}
    >
      <div className="flex w-36 min-w-0 items-center gap-2">
        <ColorSwatch color={look.color} className="size-5 rounded-full" />
        <span className="truncate text-body" title={look.label}>{look.label}</span>
      </div>
      <Select
        value={finish?.name ?? null}
        items={Object.fromEntries(paint.map((f) => [f.name, finishLabelOf(f)]))}
        onValueChange={changeFinish}
        onOpenChangeComplete={releaseFocus}
      >
        <SelectTrigger className="w-24 shrink-0" aria-label="Finish" tabIndex={-1}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent side="top" alignItemWithTrigger={false}>
          {paint.map((f) => <SelectItem key={f.name} value={f.name}>{finishLabelOf(f)}</SelectItem>)}
        </SelectContent>
      </Select>
      {finish !== undefined && (
        <FinishSwatches
          finish={finish}
          choice={choice}
          onPick={(color) => pick({ _tag: "Material", material: color.material })}
          label="Colour"
          className="gap-1.5"
          swatchProps={noFocus}
        />
      )}
      {surfaces.length > 0 && (
        <>
          <span aria-hidden className={GROUP_DIVIDER} />
          <div className="flex items-center gap-1.5" role="group" aria-label="Surface">
            {surfaces.map((surface, value) => (
              <SwatchButton
                key={surface.name}
                label={surfaceLabelOf(surfaces, value)}
                color={surfaceColorOf(surfaces, value, table)}
                active={brush._tag === "Surface" && brush.value === value}
                onPick={() => pick({ _tag: "Surface", value })}
                {...noFocus}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** In the status bar while the paint tool is on: what its clicks do, or why what the pointer is over takes no paint. */
export function PaintToolStatus() {
  const on = useEditor((s) => s.tool === "paint")
  const reason = useEditor((s) => s.paintBlockedReason)
  const keybinds = useEditor((s) => s.keybinds)
  if (!on) return null
  return reason === null
    ? <span className="min-w-0 truncate text-fg-secondary">{paintHintOf(keybinds)}</span>
    : <span className="min-w-0 truncate text-destructive">{reason}</span>
}
