import { ColorSwatch } from "@workspace/ui/components/color-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import type { Item } from "../domain/MapFile"
import { lookupMaterial } from "../domain/Materials"
import {
  choiceOf,
  colorForFinish,
  colorLabelOf,
  cssColor,
  finishLabelOf,
  materialLabelOf,
  offPanelSlotsOf,
  type PaintColor,
  type PaintFinish,
  paintGroups,
  paintTargets,
  shownFinishOf,
  swatchColor
} from "../domain/Paint"
import { pieceNameOf } from "../domain/structure"
import { paintSlots } from "../editor/actions"
import { useEditor } from "../editor/store"
import { HintBadge } from "./HintBadge"
import { InfoHint } from "./InfoHint"

export interface SelectedItem {
  readonly id: string
  readonly item: Item
}

/** One mesh component's material slot across a group of items. */
interface SlotTarget {
  readonly component: number
  readonly slot: number
}

const slotsOf = (
  members: ReadonlyArray<SelectedItem>,
  only: ReadonlySet<number> | undefined
): ReadonlyArray<SlotTarget> => {
  const seen = new Map<string, SlotTarget>()
  for (const { item } of members) {
    item.meshComponents.forEach((mesh, component) => {
      for (const { materialIndex: slot } of mesh.materials) {
        if (only === undefined || only.has(slot)) seen.set(`${component}:${slot}`, { component, slot })
      }
    })
  }
  return [...seen.values()].sort((a, b) => a.component - b.component || a.slot - b.slot)
}

const materialAt = (item: Item, { component, slot }: SlotTarget): string | undefined =>
  item.meshComponents[component]?.materials.find((m) => m.materialIndex === slot)?.material

function Swatch(
  { finish, color, active, onPick }: {
    readonly finish: PaintFinish
    readonly color: PaintColor
    readonly active: boolean
    readonly onPick: () => void
  }
) {
  const table = useEditor((s) => s.materialTable)
  const label = `${finishLabelOf(finish)} ${colorLabelOf(color)}`
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onPick}
      className={cn(
        "size-5 rounded-control ring-1 ring-foreground/20 transition-shadow outline-none hover:ring-2 hover:ring-foreground/60 focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-primary ring-offset-1 ring-offset-card hover:ring-primary"
      )}
      style={{ background: cssColor(swatchColor(lookupMaterial(table, color.material), color.displayColor)) }}
    />
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
 * asset's own name is in Details.
 */
function SlotPaintRow(
  { members, target, numbered, offPanel }: {
    readonly members: ReadonlyArray<SelectedItem>
    readonly target: SlotTarget
    /** Whether the slot says which it is, when its piece has more than one. */
    readonly numbered: boolean
    /** Whether the game's paint panel leaves this slot out. */
    readonly offPanel: boolean
  }
) {
  const paint = useEditor((s) => s.paint)
  const table = useEditor((s) => s.materialTable)
  // A finish browsed without picking a colour yet; otherwise the slot's own finish shows.
  const [browsing, setBrowsing] = useState<string | null>(null)
  const materials = members.map(({ item }) => materialAt(item, target))
  const first = materials[0]
  const current = materials.every((m) => m === first) ? first : null
  const choice = current === null ? undefined : choiceOf(paint, current)
  const finish = paint.find((f) => f.name === browsing) ?? shownFinishOf(paint, choiceOf(paint, first))

  const apply = (material: string) => {
    setBrowsing(null)
    paintSlots(
      members.flatMap(({ id, item }) => materialAt(item, target) === undefined ? [] : [{ id, ...target, material }])
    )
  }
  const changeFinish = (name: string | null) => {
    const next = paint.find((f) => f.name === name)
    if (next === undefined) return
    // The game goes by the first item of a mixed selection.
    const color = colorForFinish(next, choiceOf(paint, first))
    if (color === undefined) setBrowsing(next.name)
    else apply(color.material)
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
          {numbered && <span className="text-body text-fg-secondary">{slotName}</span>}
          {offPanel && <HintBadge label="Off-panel">{OFF_PANEL_HINT}</HintBadge>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ColorSwatch color={swatch} className="size-5" />
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
      {finish !== undefined && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`${slotName} color`}>
          {finish.colors.map((color) => (
            <Swatch
              key={color.color}
              finish={finish}
              color={color}
              active={choice?.finish === finish && choice.color === color}
              onPick={() => apply(color.material)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Note({ children }: { readonly children: string }) {
  return <div className="text-body text-fg-tertiary">{children}</div>
}

function PaintGroup(
  { members, showName }: { readonly members: ReadonlyArray<SelectedItem>; readonly showName: boolean }
) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const first = members[0]
  if (first === undefined) return null
  const offPanel = offPanelSlotsOf(first.item, catalogIndex)
  const slots = slotsOf(members, offPanel)
  return (
    <div className="flex flex-col gap-3">
      {showName && (
        <div className="text-body-strong">
          {pieceNameOf(first.item, catalogIndex)}
          {members.length > 1 && <span className="ml-1 text-body text-fg-tertiary">× {members.length}</span>}
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

/**
 * The game's Paint panel: material and colour per slot, for the selected items it lists (see
 * `paintTargets`). Items of the same piece are edited together; an edit is one undo step.
 */
export function PaintSection({ selected }: { readonly selected: ReadonlyArray<SelectedItem> }) {
  const loaded = useEditor((s) => s.paint.length > 0)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const { items, surfaceLocked } = paintTargets(selected, catalogIndex)
  if (surfaceLocked) return <Note>Paint is locked while a surface is set.</Note>
  if (items.length === 0) return <Note>The game doesn't paint this piece.</Note>
  if (!items.some(({ item }) => item.meshComponents.some((m) => m.materials.length > 0))) {
    return <Note>No material slots.</Note>
  }
  if (!loaded) return <Note>The game's materials aren't loaded.</Note>
  return (
    <div className="flex flex-col gap-4">
      {paintGroups(items).map((members) => (
        <PaintGroup key={members.map((m) => m.id).join(",")} members={members} showName={items.length > 1} />
      ))}
    </div>
  )
}
