/**
 * The Inspector's fields over a selection of things (the editor's rules § 4, docs/DESKTOP.md § Group pivots and chains):
 * a thing is one selected unit, a loose piece, a whole group, a whole chain, an instance, or a link inside an entered
 * chain. Every thing reads its own value, and what's typed is worked out for each from that (`workOutEntry`), then taken
 * to it whole: a group moves, turns or scales about its pivot until its value lands, so a field never pulls one apart.
 */
import type { UeTransform, Vec3 } from "./coords"
import { type Axis, fieldTo, readField } from "./groupTransform"
import { sizeAt } from "./itemBounds"
import { type NumberEntry, workOutEntry } from "./numberEntry"
import { ORIGIN, vecAdd, vecScale, vecSub } from "./ueMath"
import type { SelectionUnits, Unit } from "./units"

/**
 * Which row a field is in: the Transform section's Location, Rotation, Scale as a factor or as a size, or the Pivot
 * section's Position.
 */
export type FieldKind = "location" | "rotation" | "scale" | "size" | "pivot"

/**
 * A row as shown: its kind, how many centimetres one shown unit is (a location, a size or a position; else 1), and for
 * a location or a position the world point that reads 0 (`documentOrigin`), the world's origin by default. Edits work
 * on differences, so only what's read and pasted depends on it.
 */
export interface FieldView {
  readonly kind: FieldKind
  readonly perUnit: number
  readonly origin?: Vec3
}

/** One selected thing: its unit, and the size of the item it takes its transform from at scale 1, when known. */
export interface Thing {
  readonly unit: Unit
  readonly extent: Vec3 | undefined
}

/**
 * The selection's units in selection order, the order `L(a, b)`, `$i` and `$prev` count in: by where each one's first
 * item is in `selectedIds`, and inside an entered chain in chain order.
 */
export const thingsInOrder = (selection: SelectionUnits, selectedIds: ReadonlyArray<string>): ReadonlyArray<Unit> => {
  const { chain, units } = selection
  const place = new Map<string, number>()
  if (chain === undefined) selectedIds.forEach((id, i) => place.has(id) || place.set(id, i))
  else chain.forEach((link, i) => place.set(link.id, i))
  const at = (unit: Unit) =>
    Math.min(...(chain === undefined ? unit.keys : [unit.id]).map((key) => place.get(key) ?? Infinity))
  return units.toSorted((a, b) => at(a) - at(b))
}

/** A thing's three values in the row, as shown; undefined for a size it can't measure. */
export const readThing = ({ unit, extent }: Thing, view: FieldView): Vec3 | undefined => {
  const { transform } = unit
  switch (view.kind) {
    case "location":
      return vecScale(vecSub(transform.translation, view.origin ?? ORIGIN), 1 / view.perUnit)
    case "rotation":
      return readField(transform, "rotation")
    case "scale":
      return transform.scale3D
    case "size":
      return extent === undefined ? undefined : vecScale(sizeAt(extent, transform.scale3D), 1 / view.perUnit)
    case "pivot":
      return vecScale(vecSub(unit.pivot, view.origin ?? ORIGIN), 1 / view.perUnit)
  }
}

const AXES: ReadonlyArray<Axis> = ["x", "y", "z"]

/** What takes `thing`'s values in the row from `from` to `to`, item by item; undefined when nothing changes. */
const thingEdit = (
  { unit, extent }: Thing,
  view: FieldView,
  from: Vec3,
  to: Vec3
): ((t: UeTransform) => UeTransform) | undefined => {
  if (AXES.every((axis) => from[axis] === to[axis])) return undefined
  const { transform, pivot } = unit
  switch (view.kind) {
    case "location":
    case "pivot":
      return fieldTo(transform, "translation", vecAdd(transform.translation, vecScale(vecSub(to, from), view.perUnit)))
    case "rotation":
      return fieldTo(transform, "rotation", to, pivot)
    case "scale":
      return fieldTo(transform, "scale3D", to, pivot)
    case "size": {
      if (extent === undefined) return undefined
      // a size keeps the flip its scale has
      const scaleOf = (axis: Axis) =>
        from[axis] === to[axis]
          ? transform.scale3D[axis]
          : (transform.scale3D[axis] < 0 ? -1 : 1) * to[axis] * view.perUnit / extent[axis]
      return fieldTo(transform, "scale3D", { x: scaleOf("x"), y: scaleOf("y"), z: scaleOf("z") }, pivot)
    }
  }
}

/**
 * The items' transforms once the entries, one for any of the row's axes, are worked out for every thing in order and
 * each thing is taken whole to its values. Only the things' own items change: a link inside an entered chain carries
 * nothing after it. `transforms` holds every thing's items as they are.
 */
export const editThings = (
  things: ReadonlyArray<Thing>,
  view: FieldView,
  entries: Partial<Readonly<Record<Axis, NumberEntry>>>,
  transforms: ReadonlyMap<string, UeTransform>
): ReadonlyMap<string, UeTransform> => {
  const values = things.map((thing) => readThing(thing, view))
  const targets = values.map((value) => value === undefined ? undefined : { ...value })
  for (const axis of AXES) {
    const entry = entries[axis]
    if (entry === undefined) continue
    workOutEntry(entry, values.map((value) => value?.[axis])).forEach((worked, i) => {
      const target = targets[i]
      if (target !== undefined && worked !== undefined) target[axis] = worked
    })
  }
  const out = new Map<string, UeTransform>()
  things.forEach((thing, i) => {
    const [from, to] = [values[i], targets[i]]
    const edit = from === undefined || to === undefined ? undefined : thingEdit(thing, view, from, to)
    if (edit === undefined) return
    for (const key of thing.unit.keys) {
      const t = transforms.get(key)
      if (t !== undefined) out.set(key, edit(t))
    }
  })
  return out
}

/** The one value every one of `values` shows, or null when they differ ("Multiple") or one has none. */
export const sharedValue = (values: ReadonlyArray<number | undefined>, tolerance: number): number | null => {
  const [first] = values
  if (first === undefined) return null
  return values.every((value) => value !== undefined && Math.abs(value - first) <= tolerance) ? first : null
}
