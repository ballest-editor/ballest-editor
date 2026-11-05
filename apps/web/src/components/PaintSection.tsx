import { Badge } from "@workspace/ui/components/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { classNameOf, type Item } from "../domain/MapFile"
import { assetNameOf, lookupMaterial } from "../domain/Materials"
import {
  choiceOf,
  colorForFinish,
  cssColor,
  offPanelSlotsOf,
  type PaintColor,
  type PaintFinish,
  paintGroups,
  paintTargets,
  swatchColor
} from "../domain/Paint"
import { paintSlots } from "../editor/actions"
import { useEditor } from "../editor/store"

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
  const label = `${finish.name} ${color.color}`
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onPick}
      className={cn(
        "size-5 rounded-sm ring-1 ring-foreground/20 transition-shadow outline-none hover:ring-2 hover:ring-foreground/60 focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-primary ring-offset-1 ring-offset-card hover:ring-primary"
      )}
      style={{ background: cssColor(swatchColor(lookupMaterial(table, color.material), color.displayColor)) }}
    />
  )
}

/**
 * One material slot over a group, as in the game: pick a finish (smooth, rough, ...), then a
 * colour. Changing the finish keeps the colour when the new finish has it (`colorForFinish`);
 * otherwise it only shows that finish's colours until one is picked.
 */
function SlotPaintRow(
  { members, target }: {
    readonly members: ReadonlyArray<SelectedItem>
    readonly target: SlotTarget
  }
) {
  const paint = useEditor((s) => s.paint)
  // A finish browsed without picking a colour yet; otherwise the slot's own finish shows.
  const [browsing, setBrowsing] = useState<string | null>(null)
  const materials = members.map(({ item }) => materialAt(item, target))
  const first = materials[0]
  const current = materials.every((m) => m === first) ? first : null
  const choice = current === null ? undefined : choiceOf(paint, current)
  const finish = paint.find((f) => f.name === (browsing ?? choice?.finish.name))

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
  const caption = current === null
    ? "Mixed"
    : current === undefined
    ? "No material"
    : choice === undefined
    ? `${assetNameOf(current)} (not in the game's picker)`
    : `${choice.color.color} · ${assetNameOf(current)}`

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs">{slotName}</span>
        <Select
          value={finish?.name ?? null}
          items={Object.fromEntries(paint.map((f) => [f.name, f.name]))}
          onValueChange={changeFinish}
        >
          <SelectTrigger className="w-28" aria-label={`${slotName} material`}>
            <SelectValue placeholder="Material" />
          </SelectTrigger>
          <SelectContent>
            {paint.map((f) => <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>)}
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
      <div className="truncate font-mono text-[0.65rem] text-muted-foreground" title={current ?? undefined}>
        {caption}
      </div>
    </div>
  )
}

const OFF_PANEL_HINT =
  "The game's paint panel doesn't offer this slot, but it draws and keeps paint set here, and the map still validates."

function Note({ children }: { readonly children: string }) {
  return <div className="text-xs text-muted-foreground">{children}</div>
}

function PaintGroup(
  { members, showName }: { readonly members: ReadonlyArray<SelectedItem>; readonly showName: boolean }
) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const first = members[0]
  if (first === undefined) return null
  const name = catalogIndex?.pieceByClass.get(first.item.actorToSpawn)?.displayName ??
    classNameOf(first.item.actorToSpawn)
  const offPanel = offPanelSlotsOf(first.item, catalogIndex)
  return (
    <div className="flex flex-col gap-3">
      {showName && (
        <div className="text-xs font-semibold">
          {name}
          <span className="ml-1 font-normal text-muted-foreground">× {members.length}</span>
        </div>
      )}
      {offPanel !== undefined && (
        // Every slot listed for such a piece is off-panel, so it's said once for the group.
        <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Badge variant="outline" title={OFF_PANEL_HINT}>Off-panel</Badge>
          <span>Not in the game's panel, but paint set here draws.</span>
        </div>
      )}
      {slotsOf(members, offPanel).map((target) => (
        <SlotPaintRow
          // a different set of items starts with no finish being browsed
          key={`${members.map((m) => m.id).join(",")}:${target.component}:${target.slot}`}
          members={members}
          target={target}
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
