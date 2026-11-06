/**
 * Between a prefab file and map items, the one place the two formats meet (docs/FORMAT.md § Prefab file): Euler degrees
 * and quaternions, bare and class-qualified paths, the flat `properties` map and the typed lists. Also the frame the game
 * measures a prefab against, and where a spawn puts it.
 */
import type { PrefabRef, PrefabTier } from "@ballest/contracts"
import { Predicate } from "effect"
import type { CatalogIndex, CatalogPiece } from "./Catalog"
import type { Vec3 } from "./coords"
import { meshComponentFor, newMapFile, nextNumberedName, qualifyMaterialPath } from "./factory"
import { gameGroupNameOf } from "./gameGroups"
import { refusesMeshComponents } from "./gameRules"
import { boxCentreOf, itemsBoxOf } from "./itemBounds"
import { DEFAULT_PLAYER_START } from "./level"
import { type Item, type MapFile, type MeshComponent, objectPathOf, PropertyList } from "./MapFile"
import { pieceDisplayName, pieceLabelOf } from "./pieceName"
import {
  PREFAB_FORMAT,
  PREFAB_VERSION,
  type PrefabFile,
  type PrefabItem,
  type PrefabMesh,
  type PrefabPropertyValue
} from "./PrefabFile"
import { quatToRotator, rotatorToQuat } from "./ueMath"

export { isPrefabName, PREFAB_NAME_RULE } from "@ballest/contracts"

/** A tier as the UI names it: `user` is the game's own folder. A browser's one tier lasts the session. */
export const prefabTierLabel = (tier: PrefabTier, projects: boolean): string =>
  !projects ? "Session" : tier === "user" ? "Game" : "Project"

/** Why the project tier is off in Untitled Project. */
export const PREFAB_NEEDS_PROJECT = "Name the project first."

export const isSamePrefab = (a: PrefabRef, b: PrefabRef): boolean => a.tier === b.tier && a.name === b.name

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }

type NamedPiece = Pick<CatalogPiece, "className"> & Partial<Pick<CatalogPiece, "displayName">>

/** A piece's name without its size or number: "Kicker" for Kicker 1 Small. */
const familyOf = (piece: NamedPiece) => pieceDisplayName(piece).name.replace(/\s+\d+$/, "")

/** What a selection of `pieces` reads as: "Kicker pair", "Curve 1 Medium x3", "Kicker set" for a mix. */
export const selectionLabelOf = (pieces: ReadonlyArray<NamedPiece>): string => {
  const [first] = pieces
  if (first === undefined) return "Prefab"
  if (new Set(pieces.map(pieceLabelOf)).size > 1) return `${familyOf(first)} set`
  return pieces.length === 2 ? `${familyOf(first)} pair` : `${pieceLabelOf(first)} x${pieces.length}`
}

/**
 * `label` as a prefab may be called, and clear of the names in `taken`. A name is its file's, so `saveprefab`'s rule
 * turns spaces into underscores, and room is left for the number a copy gets (`nextNumberedName`).
 */
export const freePrefabName = (label: string, taken: ReadonlySet<string>): string => {
  const name = label.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Prefab"
  return taken.has(name) ? nextNumberedName(name, "_", (next) => taken.has(next)) : name
}

/** What each property list holds when the catalog doesn't say: how a value's type shows in a map. */
const listOfValue = (value: PrefabPropertyValue): { readonly list: PropertyList; readonly type: string } => {
  if (typeof value === "boolean") return { list: "boolProperties", type: "Bool" }
  if (typeof value === "string") return { list: "stringProperties", type: "String" }
  return Number.isInteger(value)
    ? { list: "intProperties", type: "Integer" }
    : { list: "floatProperties", type: "Float" }
}

const propertyListsOf = (item: PrefabItem, piece: CatalogPiece | undefined): Pick<Item, PropertyList> => {
  const entries = Object.entries(item.properties).map(([propertyName, currentValue]) => {
    const known = piece?.properties?.find((property) => property.name === propertyName)
    const { list, type } = known?.list != null && known.type != null
      ? { list: known.list, type: known.type }
      : listOfValue(currentValue)
    return { currentValue, list, propertyName, propertyType: type }
  })
  const listed = <V extends PrefabPropertyValue>(
    wanted: PropertyList,
    is: (value: PrefabPropertyValue) => value is V
  ) =>
    entries.flatMap(({ currentValue, list, propertyName, propertyType }) =>
      list === wanted && is(currentValue) ? [{ currentValue, propertyName, propertyType }] : []
    )
  return {
    boolProperties: listed("boolProperties", Predicate.isBoolean),
    floatProperties: listed("floatProperties", Predicate.isNumber),
    intProperties: listed("intProperties", Predicate.isNumber),
    textProperties: listed("textProperties", Predicate.isNotNullish),
    nameProperties: listed("nameProperties", Predicate.isNotNullish),
    stringProperties: listed("stringProperties", Predicate.isNotNullish)
  }
}

const meshComponentOf = ({ materials, mesh, tag }: PrefabMesh): MeshComponent => ({
  ...meshComponentFor(mesh, materials.map(qualifyMaterialPath)),
  meshComponentTag: tag
})

/** A class path as a map writes it. A prefab's is bare, though the map's wrapped form loads too. */
export const qualifyClassPath = (path: string): string =>
  path.includes("'") ? path : `/Script/Engine.BlueprintGeneratedClass'${path}'`

/**
 * A prefab's item as a map holds it, with `frame` as the point its `location` is relative to. `paint` has no field in a
 * map, and the game writes the same materials into `meshes`. A class the game only reloads with no components gets none
 * here, whatever the prefab saved, or the map it lands in would open blank.
 */
export const itemOfPrefab = (source: PrefabItem, frame: Vec3, catalog: CatalogIndex | null): Item => {
  const actorToSpawn = qualifyClassPath(source.class)
  const { location: [x, y, z], rotation: [pitch, yaw, roll], scale: [sx, sy, sz] } = source.transform
  return {
    actorToSpawn,
    itemTransform: {
      rotation: { ...rotatorToQuat({ pitch, yaw, roll }) },
      translation: { x: frame.x + x, y: frame.y + y, z: frame.z + z },
      scale3D: { x: sx, y: sy, z: sz }
    },
    meshComponents: refusesMeshComponents(actorToSpawn) ? [] : source.meshes.map(meshComponentOf),
    bIsBaseItem: false,
    ...propertyListsOf(source, catalog?.pieceByClass.get(actorToSpawn))
  }
}

const isPropertyValue = (value: unknown): value is PrefabPropertyValue =>
  typeof value === "boolean" || typeof value === "number" || typeof value === "string"

const prefabMeshOf = (mesh: MeshComponent): PrefabMesh => ({
  tag: mesh.meshComponentTag,
  mesh: mesh.meshAssetPath ?? "",
  materials: mesh.materialAssetPaths ??
    [...mesh.materials].sort((a, b) => a.materialIndex - b.materialIndex).map(({ material }) => objectPathOf(material))
})

/** A map item as a prefab holds it, `location` being relative to `frame`, in world axes. */
export const prefabItemOf = (item: Item, frame: Vec3): PrefabItem => {
  const { rotation, scale3D, translation } = item.itemTransform
  const { pitch, roll, yaw } = quatToRotator(rotation)
  return {
    class: objectPathOf(item.actorToSpawn),
    transform: {
      location: [translation.x - frame.x, translation.y - frame.y, translation.z - frame.z],
      rotation: [pitch, yaw, roll],
      scale: [scale3D.x, scale3D.y, scale3D.z]
    },
    properties: Object.fromEntries(
      PropertyList.literals.flatMap((list) =>
        item[list].flatMap(({ currentValue, propertyName }) =>
          isPropertyValue(currentValue) ? [[propertyName, currentValue] as const] : []
        )
      )
    ),
    meshes: item.meshComponents.map(prefabMeshOf)
  }
}

/**
 * A new prefab of `items`, as `saveprefab` writes one: `location` from the frame, with no turn or scale, and the group's
 * name as the game takes it, when that leaves any.
 */
export const prefabOfItems = (items: ReadonlyArray<Item>, catalog: CatalogIndex | null, groupName = ""): PrefabFile => {
  const box = itemsBoxOf(items, catalog)
  const frame = box === undefined ? ORIGIN : boxCentreOf(box)
  const name = gameGroupNameOf(groupName)
  return {
    format: PREFAB_FORMAT,
    version: PREFAB_VERSION,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1], ...(name.length > 0 && { name }) },
    items: items.map((item) => prefabItemOf(item, frame))
  }
}

/**
 * Where a definition's tab holds the prefab's frame: the default start, so it sits in the sky and above the water as a
 * map does, rather than under the water at the world's origin.
 */
const TAB_FRAME: Vec3 = DEFAULT_PLAYER_START

/** A definition as a tab holds it: a map-like document with the prefab's items and nothing else. */
export const mapOfPrefab = (name: string, prefab: PrefabFile, catalog: CatalogIndex | null): MapFile => ({
  ...newMapFile({ displayName: name, creatorName: "", createdAt: "" }),
  items: prefab.items.map((item) => itemOfPrefab(item, TAB_FRAME, catalog))
})

/** What a definition's tab read of an item: the map's form and the file's, to write it back as it came. */
export interface PrefabSource {
  readonly item: Item
  readonly prefab: PrefabItem
}

const sameMaterials = (a: PrefabItem, b: PrefabItem) =>
  JSON.stringify(a.meshes.map((mesh) => mesh.materials)) === JSON.stringify(b.meshes.map((mesh) => mesh.materials))

/**
 * The file's item for one of a tab's. An item nothing has touched goes back as it came, and an edited one keeps what
 * the editor doesn't model. Its `paint` stays only while its materials do: the game would let `paint` win over a repaint.
 */
const prefabItemOfTab = (item: Item, source: PrefabSource | undefined): PrefabItem => {
  if (source === undefined) return prefabItemOf(item, TAB_FRAME)
  if (source.item === item) return source.prefab
  const { paint, ...kept } = source.prefab
  const edited = { ...kept, ...prefabItemOf(item, TAB_FRAME) }
  return paint !== undefined && sameMaterials(edited, source.prefab) ? { ...edited, paint } : edited
}

/** What a definition's tab saves: the file it read, with the tab's items (by `keys`) in place of its own. */
export const prefabOfTab = (
  file: PrefabFile,
  items: ReadonlyArray<Item>,
  keys: ReadonlyArray<string>,
  sources: ReadonlyMap<string, PrefabSource>
): PrefabFile => ({
  ...file,
  items: items.map((item, index) => prefabItemOfTab(item, sources.get(keys[index] ?? "")))
})

/** What a definition's tab keeps of `prefab`, read or saved as `items` under `keys`. */
export const prefabSourcesOf = (
  prefab: PrefabFile,
  items: ReadonlyArray<Item>,
  keys: ReadonlyArray<string>
): ReadonlyMap<string, PrefabSource> =>
  new Map(keys.flatMap((key, index) => {
    const item = items[index]
    const source = prefab.items[index]
    return item === undefined || source === undefined ? [] : [[key, { item, prefab: source }] as const]
  }))
