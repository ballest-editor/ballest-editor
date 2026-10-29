import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { classNameOf, type Item } from "../domain/MapFile"
import { assetNameOf, lookupMaterial } from "../domain/Materials"
import { choiceOf, cssColor, type PaintColor, type PaintFinish, swatchColor } from "../domain/Paint"
import { paintSlots } from "../editor/actions"
import { useEditor } from "../editor/store"

export interface SelectedItem {
  readonly id: string
  readonly item: Item
}

/** Items the game's Paint panel lists together: the same class with the same meshes. */
const groupKey = ({ item }: SelectedItem) =>
  [item.actorToSpawn, ...item.meshComponents.map((m) => m.meshAssetPath ?? "")].join("|")

const groupsOf = (selected: ReadonlyArray<SelectedItem>): ReadonlyArray<ReadonlyArray<SelectedItem>> => {
  const groups = new Map<string, Array<SelectedItem>>()
  for (const s of selected) {
    const key = groupKey(s)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [s])
    else group.push(s)
  }
  return [...groups.values()]
}

/** One mesh component's material slot across a group of items. */
interface SlotTarget {
  readonly component: number
  readonly slot: number
}

const slotsOf = (members: ReadonlyArray<SelectedItem>): ReadonlyArray<SlotTarget> => {
  const seen = new Map<string, SlotTarget>()
  for (const { item } of members) {
    item.meshComponents.forEach((mesh, component) => {
      for (const { materialIndex: slot } of mesh.materials) seen.set(`${component}:${slot}`, { component, slot })
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
 * colour. Changing the finish keeps the colour when the new finish has it; otherwise it only
 * shows that finish's colours until one is picked.
 */
function SlotPaintRow(
  { members, target }: { readonly members: ReadonlyArray<SelectedItem>; readonly target: SlotTarget }
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
    const sameColor = next.colors.find((c) => c.color === choice?.color.color)
    if (sameColor === undefined) setBrowsing(next.name)
    else apply(sameColor.material)
  }

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
        <span className="text-xs">Slot {target.slot}</span>
        <Select
          value={finish?.name ?? null}
          items={Object.fromEntries(paint.map((f) => [f.name, f.name]))}
          onValueChange={changeFinish}
        >
          <SelectTrigger size="sm" className="w-28" aria-label={`Slot ${target.slot} material`}>
            <SelectValue placeholder="Material" />
          </SelectTrigger>
          <SelectContent>
            {paint.map((f) => <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {finish !== undefined && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Slot ${target.slot} color`}>
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

function PaintGroup(
  { members, showName }: { readonly members: ReadonlyArray<SelectedItem>; readonly showName: boolean }
) {
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const first = members[0]
  if (first === undefined) return null
  const name = catalogIndex?.pieceByClass.get(first.item.actorToSpawn)?.displayName ??
    classNameOf(first.item.actorToSpawn)
  return (
    <div className="flex flex-col gap-3">
      {showName && (
        <div className="text-xs font-semibold">
          {name}
          <span className="ml-1 font-normal text-muted-foreground">× {members.length}</span>
        </div>
      )}
      {slotsOf(members).map((target) => (
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
 * The game's Paint panel: material and colour per slot, for every selected item. Items of
 * the same piece are edited together; an edit is one undo step.
 */
export function PaintSection({ selected }: { readonly selected: ReadonlyArray<SelectedItem> }) {
  const loaded = useEditor((s) => s.paint.length > 0)
  const groups = groupsOf(selected)
  const anySlots = selected.some(({ item }) => item.meshComponents.some((m) => m.materials.length > 0))
  if (!anySlots) return <div className="text-xs text-muted-foreground">No material slots.</div>
  if (!loaded) return <div className="text-xs text-muted-foreground">The game's materials aren't loaded.</div>
  return (
    <div className="flex flex-col gap-4">
      {groups.map((members) => (
        <PaintGroup key={members.map((m) => m.id).join(",")} members={members} showName={selected.length > 1} />
      ))}
    </div>
  )
}
