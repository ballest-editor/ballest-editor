/**
 * Items whose scale the game controls. An item's edit transform is what the game's inspector
 * and gizmo show and change; the editor's own gizmo, inspector and pivot maths work on it, and
 * it turns back into the item only where a transform enters the document. For most items it
 * is simply `itemTransform`. See docs/FORMAT.md, "Decals" and "Elevators".
 *
 * A decal has no scale of its own: `scale3D` stays 1 and its size is three float properties,
 * shown as the Scale (X `DecalHeight`, Y `DecalWidth`, Z `DecalDepth`, in cm). A ±0.5 pivot on
 * a size of 200 is 100 cm out, as in game.
 *
 * An elevator's X and Y are one size and its Z is 1.
 */
import type { UeTransform, Vec3 } from "./coords"
import { keepPoint } from "./groupTransform"
import type { Item, ItemTransform } from "./MapFile"

const DECAL_CLASSES: ReadonlySet<string> = new Set(
  ["BP_UGCCircuitDecal", "BP_UGCShapeDecal"].map((name) =>
    `/Script/Engine.BlueprintGeneratedClass'/Game/MapItems/Decals/${name}.${name}_C'`
  )
)

export const isDecal = (item: Item): boolean => DECAL_CLASSES.has(item.actorToSpawn)

const ELEVATOR_CLASS =
  "/Script/Engine.BlueprintGeneratedClass'/Game/LevelEditor/PackageAssets/BallestAssets/PhysicsProps/BP_Elevator.BP_Elevator_C'"
const MIN_ELEVATOR_SCALE = 0.01

/**
 * An elevator's scale from `requested`: the edited axis sets the size (X if both or neither
 * changed from `current`), each axis keeps its requested sign, and Z is 1.
 */
const elevatorScale = (requested: Vec3, current?: Vec3) => {
  const onlyY = current !== undefined && requested.x === current.x && requested.y !== current.y
  const size = Math.max(Math.abs(onlyY ? requested.y : requested.x), MIN_ELEVATOR_SCALE)
  return { x: requested.x < 0 ? -size : size, y: requested.y < 0 ? -size : size, z: 1 }
}

/** Each scale axis's property, default size and the limits the game holds it to (cm). */
const SIZE = {
  x: { property: "DecalHeight", size: 200, max: 2000 },
  y: { property: "DecalWidth", size: 200, max: 2000 },
  z: { property: "DecalDepth", size: 100, max: 1000 }
} as const
const MIN_SIZE = 10

/** The properties a decal's edit scale lives in: a change to one is a change of transform. */
export const SCALE_PROPERTIES: ReadonlySet<string> = new Set(Object.values(SIZE).map(({ property }) => property))

type Axis = keyof typeof SIZE
const AXES: ReadonlyArray<Axis> = ["x", "y", "z"]

/** The size the mesh drawn for a decal (the engine sphere) is modelled in, so it fills the decal's box. */
export const DECAL_VISUAL_SCALE = 0.01

const sizeOf = (item: Item, axis: Axis): number => {
  const value = item.floatProperties.find((p) => p.propertyName === SIZE[axis].property)?.currentValue
  return typeof value === "number" ? value : SIZE[axis].size
}

/** `item`'s transform as the editor edits it. */
export const editTransform = (item: Item): ItemTransform => {
  const t = item.itemTransform
  if (isDecal(item)) return { ...t, scale3D: { x: sizeOf(item, "x"), y: sizeOf(item, "y"), z: sizeOf(item, "z") } }
  return item.actorToSpawn === ELEVATOR_CLASS ? { ...t, scale3D: elevatorScale(t.scale3D) } : t
}

/**
 * Edit transform `t` as the game would take it. A scale is held to the item's limits and the
 * item moves so `localPivot` stays where `t` put it; anything else is `t`. A decal's axis that
 * didn't change is left alone, so moving a decal never resizes it. An elevator's X and Y are
 * linked after that, without moving it, so the game's pivot slides when one follows the other
 * or a Z is dropped, and this copies that.
 */
export const fitEditTransform = <T extends UeTransform>(item: Item, t: T, localPivot: Vec3): T => {
  if (item.actorToSpawn === ELEVATOR_CLASS) {
    const held = (v: number) => (v < 0 ? -1 : 1) * Math.max(Math.abs(v), MIN_ELEVATOR_SCALE)
    const { x, y, z } = t.scale3D
    const requested = keepPoint(t, { ...t, scale3D: { x: held(x), y: held(y), z: held(z) } }, localPivot)
    return { ...requested, scale3D: elevatorScale(requested.scale3D, editTransform(item).scale3D) }
  }
  if (!isDecal(item)) return t
  const fit = (axis: Axis) => {
    const value = t.scale3D[axis]
    return value === sizeOf(item, axis) ? value : Math.min(Math.max(value, MIN_SIZE), SIZE[axis].max)
  }
  const scale3D = { x: fit("x"), y: fit("y"), z: fit("z") }
  if (AXES.every((axis) => scale3D[axis] === t.scale3D[axis])) return t
  return keepPoint(t, { ...t, scale3D }, localPivot)
}

const withSize = (item: Item, scale: Vec3): Item => {
  const missing = AXES.filter((axis) => !item.floatProperties.some((p) => p.propertyName === SIZE[axis].property))
  const axisOf = (name: string) => AXES.find((axis) => SIZE[axis].property === name)
  return {
    ...item,
    floatProperties: [
      ...item.floatProperties.map((p) => {
        const axis = axisOf(p.propertyName)
        return axis === undefined ? p : { ...p, currentValue: scale[axis] }
      }),
      ...missing.map((axis) => ({
        propertyName: SIZE[axis].property,
        propertyType: "Float",
        currentValue: scale[axis]
      }))
    ]
  }
}

/** `item` with edit transform `t` applied: a decal's scale goes to its size, and its own stays as it was. */
export const withEditTransform = (item: Item, t: ItemTransform, localPivot: Vec3): Item => {
  const fitted = fitEditTransform(item, t, localPivot)
  if (!isDecal(item)) return { ...item, itemTransform: { ...item.itemTransform, ...fitted } }
  const { scale3D, ...placed } = fitted
  const same = AXES.every((axis) => scale3D[axis] === sizeOf(item, axis))
  return { ...(same ? item : withSize(item, scale3D)), itemTransform: { ...item.itemTransform, ...placed } }
}
