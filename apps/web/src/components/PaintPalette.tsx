import { IconLayoutGrid } from "@tabler/icons-react"
import { ColorSwatch } from "@workspace/ui/components/color-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import { Fragment, useState } from "react"
import { lookupMaterial, type MaterialTable } from "../domain/Materials"
import {
  choiceOf,
  colorForFinish,
  colorLabelOf,
  cssColor,
  finishLabelOf,
  materialLabelOf,
  type PaintChoice,
  type PaintPicker,
  shownFinishOf,
  swatchColor
} from "../domain/Paint"
import type { Surfaces } from "../domain/surface"
import { updateSettings } from "../editor/actions"
import { type Brush, paintHintOf } from "../editor/paintTarget"
import { currentBrush, useEditor } from "../editor/store"
import { DEFAULT_LABEL, DEFAULT_SWATCH, DefaultSwatch, FinishSwatches, SwatchButton } from "./PaintSection"
import { GROUP_DIVIDER, noFocus, releaseFocus, SEGMENT, SURFACE } from "./viewControlStyle"
import { ViewTip } from "./ViewTip"

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

/** What the brush paints, as a person would say it, and its swatch colour (null: no surface, or the default's own). */
const brushLookOf = (
  brush: Brush,
  paint: PaintPicker,
  surfaces: Surfaces,
  table: MaterialTable | null
): { readonly label: string; readonly color: string | null } => {
  if (brush._tag === "Surface") {
    return { label: surfaceLabelOf(surfaces, brush.value), color: surfaceColorOf(surfaces, brush.value, table) }
  }
  if (brush._tag === "Default") return { label: DEFAULT_LABEL, color: null }
  const choice = choiceOf(paint, brush.material)
  return {
    label: choice === undefined
      ? materialLabelOf(brush.material)
      : `${finishLabelOf(choice.finish)} ${colorLabelOf(choice.color)}`,
    color: cssColor(swatchColor(lookupMaterial(table, brush.material), choice?.color.displayColor))
  }
}

/** The palette's parts both views share: what they show and what a pick sets. */
interface Parts {
  readonly brush: Brush
  readonly choice: PaintChoice | undefined
  readonly pick: (brush: Brush) => void
}

/** The default's swatch, ringed while it is the brush. */
function DefaultChoice({ brush, pick }: Parts) {
  return (
    <DefaultSwatch
      label={`${DEFAULT_LABEL}: each slot as the piece comes`}
      active={brush._tag === "Default"}
      onPick={() => pick({ _tag: "Default" })}
      {...noFocus}
    />
  )
}

/** The surfaces' swatches, which always cover a whole piece. */
function SurfaceChoices({ brush, pick }: Parts) {
  const surfaces = useEditor((s) => s.surfaces)
  const table = useEditor((s) => s.materialTable)
  return (
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
  )
}

/**
 * The game's picker as its panel has it: a finish, then its colours. A change of finish keeps the colour when the new
 * finish has it, as in the game; otherwise it only shows that finish's colours until one is picked.
 */
function RowView(parts: Parts) {
  const { choice, pick } = parts
  const paint = useEditor((s) => s.paint)
  const surfaces = useEditor((s) => s.surfaces.length > 0)
  const [browsing, setBrowsing] = useState<string | null>(null)
  const finish = paint.find((f) => f.name === browsing) ?? shownFinishOf(paint, choice)
  const choose = (next: Brush) => {
    setBrowsing(null)
    pick(next)
  }
  const changeFinish = (name: string | null) => {
    const next = paint.find((f) => f.name === name)
    if (next === undefined) return
    const color = colorForFinish(next, choice)
    if (color === undefined) setBrowsing(next.name)
    else choose({ _tag: "Material", material: color.material })
  }
  return (
    <>
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
      <div className="flex flex-wrap items-center gap-1.5">
        {finish !== undefined && (
          <FinishSwatches
            finish={finish}
            choice={choice}
            onPick={(color) => choose({ _tag: "Material", material: color.material })}
            label="Colour"
            className="gap-1.5"
            swatchProps={noFocus}
          />
        )}
        <DefaultChoice {...parts} pick={choose} />
      </div>
      {surfaces && (
        <>
          <span aria-hidden className={GROUP_DIVIDER} />
          <SurfaceChoices {...parts} pick={choose} />
        </>
      )}
    </>
  )
}

/** A label of the grid's first column. */
function RowLabel({ children }: { readonly children: string }) {
  return <span className="text-body text-fg-secondary">{children}</span>
}

/**
 * Every finish × colour at once: a row per finish in the game's order, its colours in the panel's order (the same ten
 * for all but special), then the default and the surfaces. Scrolls rather than grow past the viewport.
 */
function GridView(parts: Parts) {
  const { choice, pick } = parts
  const paint = useEditor((s) => s.paint)
  const surfaces = useEditor((s) => s.surfaces.length > 0)
  return (
    <div className="grid min-h-0 grid-cols-[auto_auto] items-center gap-x-3 gap-y-1.5 overflow-auto p-1">
      {paint.map((finish) => (
        <Fragment key={finish.name}>
          <RowLabel>{finishLabelOf(finish)}</RowLabel>
          <FinishSwatches
            finish={finish}
            choice={choice}
            onPick={(color) => pick({ _tag: "Material", material: color.material })}
            label={finishLabelOf(finish)}
            className="flex-nowrap gap-1.5"
            swatchProps={noFocus}
          />
        </Fragment>
      ))}
      <RowLabel>{DEFAULT_LABEL}</RowLabel>
      <div className="flex">
        <DefaultChoice {...parts} />
      </div>
      {surfaces && (
        <>
          <RowLabel>Surface</RowLabel>
          <SurfaceChoices {...parts} />
        </>
      )}
    </div>
  )
}

/**
 * The paint tool's palette, over the tool bar while the tool is on: what a click paints (editor/paintTarget.ts). The
 * game's picker, as the Inspector's Paint has it, or every finish × colour at once (`settings.panels.paintView`); the
 * default, which takes a slot's paint off; and the surfaces. Both views set the same brush. Pointer-only, so keybinds
 * stay with the viewport.
 */
export function PaintPalette() {
  const paint = useEditor((s) => s.paint)
  const surfaces = useEditor((s) => s.surfaces)
  const table = useEditor((s) => s.materialTable)
  const picked = useEditor((s) => s.brush)
  const setBrush = useEditor((s) => s.setBrush)
  const view = useEditor((s) => s.settings.panels.paintView)
  const brush = currentBrush({ brush: picked, paint })
  if (brush === undefined) return null // the game's materials aren't loaded
  const parts: Parts = {
    brush,
    choice: brush._tag === "Material" ? choiceOf(paint, brush.material) : undefined,
    pick: setBrush
  }
  const look = brushLookOf(brush, paint, surfaces, table)
  const grid = view === "grid"
  const toggle = (
    <ViewTip
      label="Every finish"
      side="top"
      render={
        <button
          type="button"
          aria-label="Every finish"
          aria-pressed={grid}
          onClick={() => void updateSettings("panels", { paintView: grid ? "row" : "grid" })}
          className={cn(SEGMENT, "size-7 shrink-0 px-0 aria-pressed:bg-pressed aria-pressed:text-foreground")}
          {...noFocus}
        />
      }
    >
      <IconLayoutGrid className="size-4" />
    </ViewTip>
  )
  const lookChip = (
    <div className={cn("flex min-w-0 items-center gap-2", grid ? "flex-1" : "w-36")}>
      <ColorSwatch
        color={look.color}
        className="size-5 rounded-full"
        {
          // a gradient, which the chip's background colour can't be
          ...(brush._tag === "Default" ? { style: { background: DEFAULT_SWATCH } } : {})
        }
      />
      <span className="truncate text-body" title={look.label}>{look.label}</span>
    </div>
  )

  return (
    <div
      data-paint-palette={view}
      className={cn(
        SURFACE,
        "pointer-events-auto flex max-h-full min-h-0 max-w-[calc(100%-1.5rem)] gap-x-3 gap-y-2 rounded-2xl px-3 py-2",
        grid ? "flex-col" : "flex-wrap items-center justify-center"
      )}
    >
      {grid
        ? (
          <>
            <div className="flex items-center gap-3">
              {lookChip}
              {toggle}
            </div>
            <GridView {...parts} />
          </>
        )
        : (
          <>
            {lookChip}
            <RowView {...parts} />
            {toggle}
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
