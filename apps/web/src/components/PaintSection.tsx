import { ColorSwatch } from "@workspace/ui/components/color-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import { type ComponentProps, useState } from "react"
import type { Item } from "../domain/MapFile"
import { lookupMaterial } from "../domain/Materials"
import {
  choiceOf,
  colorForFinish,
  colorLabelOf,
  cssColor,
  finishLabelOf,
  materialLabelOf,
  NOT_PAINTED,
  offPanelSlotsOf,
  type PaintChoice,
  type PaintColor,
  type PaintFinish,
  paintGroups,
  paintTargets,
  shownFinishOf,
  SURFACE_LOCKED,
  swatchColor
} from "../domain/Paint"
import { pieceNameOf } from "../domain/structure"
import { paintSlots } from "../editor/actions"
import { type Brush, type PanelSlot, panelSlotEditsOf, panelSlotPaintOf, panelSlotsOf } from "../editor/paintTarget"
import { useEditor } from "../editor/store"
import { HintBadge } from "./HintBadge"
import { InfoHint } from "./InfoHint"
import { FIELD_LABEL, Section } from "./InspectorLayout"
import { ItemIcon } from "./OutlineRow"

interface SelectedItem {
  readonly id: string
  readonly item: Item
}

/** What a swatch takes beside its own props: anything a button does, as the viewport's `noFocus`. */
type SwatchProps = Omit<ComponentProps<"button">, "color" | "onClick">

/** A round swatch to pick: a CSS colour (or any background), or null for none (a checkerboard). */
export function SwatchButton(
  { label, color, active, onPick, className, ...props }: SwatchProps & {
    readonly label: string
    readonly color: string | null
    readonly active: boolean
    readonly onPick: () => void
  }
) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onPick}
      className={cn(
        "size-5 shrink-0 rounded-full ring-1 ring-foreground/35 transition-shadow focus-ring hover:ring-2 hover:ring-foreground/60",
        color === null && "bg-[repeating-conic-gradient(var(--muted)_0_25%,var(--background)_0_50%)] bg-size-[8px_8px]",
        active && "ring-2 ring-primary ring-offset-1 ring-offset-card hover:ring-primary",
        className
      )}
      style={color === null ? undefined : { background: color }}
      {...props}
    />
  )
}

/** The default's name: a slot as its piece comes, with no paint of its own. */
export const DEFAULT_LABEL = "Default"

/** The default's swatch, a CSS background: a slashed circle, apart from every colour. */
export const DEFAULT_SWATCH =
  "linear-gradient(135deg, transparent calc(50% - 1px), var(--fg-secondary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)), var(--card)"

/** The swatch that paints a slot back to its default. */
export function DefaultSwatch(
  props: SwatchProps & { readonly label: string; readonly active: boolean; readonly onPick: () => void }
) {
  return <SwatchButton color={DEFAULT_SWATCH} {...props} />
}

/** A picker colour's swatch, as the game shows it. */
function Swatch(
  { finish, color, ...props }: SwatchProps & {
    readonly finish: PaintFinish
    readonly color: PaintColor
    readonly active: boolean
    readonly onPick: () => void
  }
) {
  const table = useEditor((s) => s.materialTable)
  return (
    <SwatchButton
      label={`${finishLabelOf(finish)} ${colorLabelOf(color)}`}
      color={cssColor(swatchColor(lookupMaterial(table, color.material), color.displayColor))}
      {...props}
    />
  )
}

/** A finish's colours as swatches to pick, with `choice` ringed when it is one of them. */
export function FinishSwatches(
  { finish, choice, onPick, label, className, swatchProps }: {
    readonly finish: PaintFinish
    readonly choice: PaintChoice | undefined
    readonly onPick: (color: PaintColor) => void
    readonly label: string
    readonly className: string
    readonly swatchProps?: SwatchProps
  }
) {
  return (
    <div className={cn("flex flex-wrap", className)} role="group" aria-label={label}>
      {finish.colors.map((color) => (
        <Swatch
          key={color.color}
          finish={finish}
          color={color}
          active={choice?.finish === finish && choice.color === color}
          onPick={() => onPick(color)}
          {...swatchProps}
        />
      ))}
    </div>
  )
}

const OFF_PANEL_HINT =
  "The game's paint panel doesn't offer this slot, but it draws and keeps paint set here, and the map still validates."

/**
 * One material slot over a group, as in the game: pick a finish (smooth, rough, ...), then a
 * colour. The finish and its colours always show, the first item's for a mixed selection and
 * the default for a slot off the picker. Changing the finish keeps the colour when the new
 * finish has it (`colorForFinish`); otherwise it only shows that finish's colours until one is
 * picked. The row reads as the material: its swatch, its colour's name and its finish. The
 * asset's own name is in Details. A slot the items leave out draws its default, and the
 * Default swatch, ringed then, takes the slot's paint off again (`panelSlotEditsOf`).
 */
function SlotPaintRow(
  { members, target, numbered, offPanel }: {
    readonly members: ReadonlyArray<SelectedItem>
    readonly target: PanelSlot
    /** Whether the slot says which it is, when its piece has more than one. */
    readonly numbered: boolean
    /** Whether the game's paint panel leaves this slot out. */
    readonly offPanel: boolean
  }
) {
  const paint = useEditor((s) => s.paint)
  const table = useEditor((s) => s.materialTable)
  const index = useEditor((s) => s.catalogIndex)
  // A finish browsed without picking a colour yet; otherwise the slot's own finish shows.
  const [browsing, setBrowsing] = useState<string | null>(null)
  const drawn = members.map(({ item }) => panelSlotPaintOf(item, index, target))
  const materials = drawn.map((d) => d.material)
  const first = materials[0]
  const current = materials.every((m) => m === first) ? first : null
  const choice = current === null ? undefined : choiceOf(paint, current)
  const finish = paint.find((f) => f.name === browsing) ?? shownFinishOf(paint, choiceOf(paint, first))
  const atDefault = drawn.every((d) => !d.listed)

  const apply = (brush: Exclude<Brush, { readonly _tag: "Surface" }>) => {
    setBrowsing(null)
    paintSlots(
      members.flatMap(({ id, item }) => panelSlotEditsOf(item, index, target, brush).map((edit) => ({ id, ...edit })))
    )
  }
  const changeFinish = (name: string | null) => {
    const next = paint.find((f) => f.name === name)
    if (next === undefined) return
    // The game goes by the first item of a mixed selection.
    const color = colorForFinish(next, choiceOf(paint, first))
    if (color === undefined) setBrowsing(next.name)
    else apply({ _tag: "Material", material: color.material })
  }

  // The game numbers its slots from 1.
  const slotName = `Slot ${target.slot + 1}`
  const offPicker = current !== null && current !== undefined && choice === undefined
  const name = current === null
    ? "Mixed"
    : current === undefined
    ? "No material"
    : choice === undefined
    ? materialLabelOf(current)
    : colorLabelOf(choice.color)
  const swatch = current === null || current === undefined
    ? null
    : cssColor(swatchColor(lookupMaterial(table, current), choice?.color.displayColor))

  return (
    <div className="flex flex-col gap-1.5">
      {(numbered || offPanel) && (
        <div className="flex items-center justify-between gap-2">
          {numbered && <span className={FIELD_LABEL}>{slotName}</span>}
          {offPanel && <HintBadge label="Off-panel">{OFF_PANEL_HINT}</HintBadge>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ColorSwatch color={swatch} className="size-5 rounded-full" />
        <span className={cn("text-body", choice === undefined && "text-fg-tertiary")}>{name}</span>
        {offPicker && <InfoHint>Not in the game's picker. It stays as it is until you paint this slot.</InfoHint>}
        <Select
          value={finish?.name ?? null}
          items={Object.fromEntries(paint.map((f) => [f.name, finishLabelOf(f)]))}
          onValueChange={changeFinish}
        >
          <SelectTrigger className="ml-auto w-24 shrink-0" aria-label={`${slotName} material`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {paint.map((f) => <SelectItem key={f.name} value={f.name}>{finishLabelOf(f)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {finish !== undefined && (
          <FinishSwatches
            finish={finish}
            choice={atDefault ? undefined : choice}
            onPick={(color) => apply({ _tag: "Material", material: color.material })}
            label={`${slotName} color`}
            className="gap-2"
          />
        )}
        <DefaultSwatch
          label={`${slotName} ${DEFAULT_LABEL.toLowerCase()}`}
          active={atDefault}
          onPick={() => apply({ _tag: "Default" })}
        />
      </div>
    </div>
  )
}

function PaintGroup(
  { members, showName }: { readonly members: ReadonlyArray<SelectedItem>; readonly showName: boolean }
) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const first = members[0]
  if (first === undefined) return null
  const offPanel = offPanelSlotsOf(first.item, catalogIndex)
  const slots = panelSlotsOf(members.map((m) => m.item), catalogIndex, offPanel)
  return (
    <div className="flex flex-col gap-3">
      {showName && (
        <div className="flex h-6 min-w-0 items-center gap-1 text-body">
          <ItemIcon actorClass={first.item.actorToSpawn} />
          <span className="truncate">{pieceNameOf(first.item, catalogIndex)}</span>
          {members.length > 1 && <span className="shrink-0 text-caption text-fg-tertiary">× {members.length}</span>}
        </div>
      )}
      {slots.map((target) => (
        <SlotPaintRow
          // a different set of items starts with no finish being browsed
          key={`${members.map((m) => m.id).join(",")}:${target.component}:${target.slot}`}
          members={members}
          target={target}
          numbered={slots.length > 1}
          offPanel={offPanel !== undefined}
        />
      ))}
    </div>
  )
}

/** Why the selection can't be painted, in short for the section's header and in full for its hint. */
const paintStatusOf = (
  { surfaceLocked, noItems, noSlots, loaded }: {
    readonly surfaceLocked: boolean
    readonly noItems: boolean
    readonly noSlots: boolean
    readonly loaded: boolean
  }
): { readonly short: string; readonly long: string } | undefined => {
  if (surfaceLocked) return { short: "Locked", long: SURFACE_LOCKED }
  if (noItems) return { short: "Not paintable", long: NOT_PAINTED }
  if (noSlots) return { short: "No slots", long: "This piece has no material slots." }
  return loaded ? undefined : { short: "Not loaded", long: "The game's materials aren't loaded." }
}

/**
 * The game's Paint panel as the Inspector's Paint section: material and colour per slot, for the selected items it
 * lists (see `paintTargets`). Items of the same piece are edited together; an edit is one undo step. A selection that
 * can't be painted is only the header, saying why.
 */
export function PaintSection({ selected }: { readonly selected: ReadonlyArray<SelectedItem> }) {
  const loaded = useEditor((s) => s.paint.length > 0)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const { items, surfaceLocked } = paintTargets(selected, catalogIndex)
  const status = paintStatusOf({
    surfaceLocked,
    noItems: items.length === 0,
    noSlots: items.length > 0 && panelSlotsOf(items.map((m) => m.item), catalogIndex, undefined).length === 0,
    loaded
  })
  if (status !== undefined) {
    return (
      <Section
        id="paint"
        title="Paint"
        actions={
          <>
            {status.short}
            <InfoHint>{status.long}</InfoHint>
          </>
        }
      />
    )
  }
  return (
    <Section id="paint" title="Paint">
      <div className="flex flex-col divide-y divide-border *:py-4 *:first:pt-0 *:last:pb-0">
        {paintGroups(items).map((members) => (
          <PaintGroup key={members.map((m) => m.id).join(",")} members={members} showName={items.length > 1} />
        ))}
      </div>
    </Section>
  )
}
