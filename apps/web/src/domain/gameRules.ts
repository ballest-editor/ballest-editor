/**
 * What the game refuses in a map beyond the rules in `limits.ts`, each measured on 0.4.1 with a probe map
 * (docs/qa/limits-validation.md). All of these lose the player's work without a message: the game opens a blank map,
 * drops the map from the Create page, or spawns an item the next save leaves out.
 */
import type { CatalogIndex, CatalogPiece } from "./Catalog"
import { classNameOf, type EditorGroup, type Item, type MapFile, PropertyList } from "./MapFile"
import { sourceMeshOf } from "./mirror"
import type { PrefabFile, PrefabItem, Triple } from "./PrefabFile"

/** UE's THRESH_QUAT_NORMALIZED: |1 - |q|^2| must be below this. */
const QUAT_NORMALIZED_THRESHOLD = 0.01

export const isNormalizedRotation = (
  q: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
): boolean => Math.abs(1 - (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)) < QUAT_NORMALIZED_THRESHOLD

/** The parser's limits on any JSON value. The file's value and character counts are in `limits.ts`. */
const JSON_LIMITS = {
  stringLength: 1_048_576,
  fieldNameLength: 4096,
  entriesPerContainer: 100_000,
  /** The root is depth 0. */
  nesting: 64
} as const

const MATERIALS_PER_MESH = 256
const ASSET_PATH_LENGTH = 4096
const EDITOR_STATE_VERSION = 1

/** The game reads the enum by name, ignoring case; any other value drops the map from the Create page. */
const DIFFICULTY_NAMES = new Set(["beginner", "medium", "advanced", "expert", "baller"])
const DIFFICULTY_PREFIX = /^EBallgameDifficulty::/i

/** ESKGMLEEditorPivot. */
const PIVOT_CHOICES = new Set([
  "Default",
  "Center",
  "Bottom",
  "Top",
  "Left",
  "Right",
  "Back",
  "Front",
  "WorldOrigin"
])

/** An empty group name is fine; any other has to be this. */
const GROUP_NAME = /^[A-Za-z0-9]{1,64}$/

/** How many items a prefab file holds, and what `saveprefab` takes from a selection. */
export const PREFAB_ITEMS = { min: 2, max: 4096 } as const

const PLAYER_START = "MP_PlayerStart"

/** The game's own words for a prefab it won't spawn. */
export const PREFAB_REFUSALS = {
  document:
    `Expected a BallestPrefab version 1 document with a valid group and ${PREFAB_ITEMS.min} to ${PREFAB_ITEMS.max} items.`,
  selection: `Select ${PREFAB_ITEMS.min} to ${PREFAB_ITEMS.max} items before saving a prefab.`,
  playerStart: "MP_PlayerStart is forbidden in prefabs.",
  groupName: "A prefab group name must contain 1 to 64 letters A-Z or digits 0-9.",
  itemClass: "A prefab item must reference a concrete level-editor item class.",
  item: (index: number) => `Item ${index} has an invalid transform, unknown property, or incorrect property value type.`
} as const

/** Baked mirror meshes: the catalog pairs most of them, not all, and they are the game's own. */
const MIRROR_MESHES = "/Game/LevelEditor/Mirror/"

/**
 * Classes the game reloads only with `meshComponents: []`: any component on one, even those it saved itself, makes it
 * discard the whole map and open a blank one (docs/qa/exposed-properties.md). They are the only classes that save two
 * components, but that isn't shown to be the cause, so the rule goes by class.
 */
const NO_MESH_COMPONENT_CLASSES = new Set(["BP_TwoCubeOneColor", "BP_TwoCubeTwoColor", "MP_OrangeSign"])

export const refusesMeshComponents = (actorToSpawn: string): boolean =>
  NO_MESH_COMPONENT_CLASSES.has(classNameOf(actorToSpawn))

const jsonProblem = (value: unknown, depth: number): string | undefined => {
  if (typeof value === "string") {
    return value.length > JSON_LIMITS.stringLength
      ? `A text field has ${value.length} characters (maximum ${JSON_LIMITS.stringLength}).`
      : undefined
  }
  if (typeof value !== "object" || value === null) return undefined
  if (depth >= JSON_LIMITS.nesting) return `The file nests deeper than ${JSON_LIMITS.nesting} levels.`
  const entries = Object.entries(value)
  if (entries.length > JSON_LIMITS.entriesPerContainer) {
    return `A list has ${entries.length} entries (maximum ${JSON_LIMITS.entriesPerContainer}).`
  }
  for (const [key, child] of entries) {
    if (key.length > JSON_LIMITS.fieldNameLength) {
      return `A field name has ${key.length} characters (maximum ${JSON_LIMITS.fieldNameLength}).`
    }
    const found = jsonProblem(child, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

const levelProblems = (map: MapFile): Array<string> => {
  const { levelDifficulty } = map.worldSettings.levelData
  return DIFFICULTY_NAMES.has(levelDifficulty.replace(DIFFICULTY_PREFIX, "").toLowerCase())
    ? []
    : [`The difficulty "${levelDifficulty}" isn't one of the game's, which would leave the map off its Create page.`]
}

const propertyProblems = (item: Item, index: number, piece: CatalogPiece | undefined): Array<string> => {
  const out: Array<string> = []
  const seen = new Set<string>()
  for (const list of PropertyList.literals) {
    for (const { propertyName } of item[list]) {
      if (propertyName.length === 0) out.push(`Item ${index} has a property with no name.`)
      else if (seen.has(propertyName)) out.push(`Item ${index} sets ${propertyName} twice.`)
      seen.add(propertyName)
      const known = piece?.properties?.find((p) => p.name === propertyName)
      if (piece !== undefined && propertyName.length > 0 && (known === undefined || !inList(known.list, list))) {
        out.push(`Item ${index} has a ${propertyName} property its class doesn't have in ${list}.`)
      }
    }
  }
  return out
}

/** A null list is one the extractor couldn't map, so any list may be the right one. */
const inList = (list: PropertyList | null, actual: PropertyList): boolean => list === null || list === actual

const materialProblems = (mesh: Item["meshComponents"][number], index: number): Array<string> => {
  const out: Array<string> = []
  const paths = mesh.materialAssetPaths ?? []
  if (mesh.materials.length > MATERIALS_PER_MESH || paths.length > MATERIALS_PER_MESH) {
    out.push(`Item ${index} has more than ${MATERIALS_PER_MESH} materials on a mesh.`)
  }
  const slots = new Set<number>()
  for (const { materialIndex } of mesh.materials) {
    if (materialIndex < 0) out.push(`Item ${index} sets material slot ${materialIndex}.`)
    if (slots.has(materialIndex)) out.push(`Item ${index} sets material slot ${materialIndex} twice.`)
    slots.add(materialIndex)
  }
  if ([mesh.meshAssetPath ?? "", ...paths].some((path) => path.length > ASSET_PATH_LENGTH)) {
    out.push(`Item ${index} has an asset path over ${ASSET_PATH_LENGTH} characters.`)
  }
  return out
}

const meshProblems = (
  item: Item,
  index: number,
  piece: CatalogPiece | undefined,
  catalog: CatalogIndex | null
): Array<string> => {
  if (item.meshComponents.length > 0 && refusesMeshComponents(item.actorToSpawn)) {
    return [
      `Item ${index} is a ${
        classNameOf(item.actorToSpawn)
      } with mesh components, which makes the game discard the whole map. Delete it.`
    ]
  }
  const out = item.meshComponents.flatMap((mesh) => materialProblems(mesh, index))
  const tags = item.meshComponents.map((mesh) => mesh.meshComponentTag)
  if (new Set(tags).size < tags.length) out.push(`Item ${index} saves the same mesh component twice.`)
  if (piece !== undefined && item.meshComponents.length > 1 + (piece.extraMeshes?.length ?? 0)) {
    out.push(`Item ${index} has ${item.meshComponents.length} mesh components, more than ${piece.className} has.`)
  }
  if (catalog === null) return out
  for (const { materialAssetPaths, meshAssetPath } of item.meshComponents) {
    if (meshAssetPath === undefined || meshAssetPath.length === 0 || meshAssetPath.startsWith(MIRROR_MESHES)) continue
    const mesh = catalog.meshes.get(sourceMeshOf(catalog, meshAssetPath))
    if (mesh === undefined) out.push(`Item ${index} uses a mesh the game doesn't have: ${meshAssetPath}.`)
    else if (mesh.slotDefaults.length > 0 && (materialAssetPaths?.length ?? 0) > mesh.slotDefaults.length) {
      out.push(
        `Item ${index} lists ${materialAssetPaths?.length} materials, but its mesh has ${mesh.slotDefaults.length}.`
      )
    }
  }
  return out
}

/**
 * A class the catalog lacks: the game either refuses the file, or spawns the actor outside the editor, where nothing
 * shows it and the next save leaves it out. `inRegistry` false is a class the game no longer ships.
 */
const classProblem = (item: Item, index: number, piece: CatalogPiece | undefined): Array<string> =>
  piece === undefined || piece.inRegistry === false
    ? [`Item ${index} is a ${classNameOf(item.actorToSpawn)}, which isn't a map piece in this game version.`]
    : []

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const isNumber = (value: unknown): value is number => typeof value === "number"

const groupProblems = ({ frame, name }: EditorGroup, index: number): Array<string> => {
  const out: Array<string> = []
  if (name !== undefined && name.length > 0 && !GROUP_NAME.test(name)) {
    out.push(`Group ${index}'s name has to be 1 to 64 letters or digits.`)
  }
  const rotation = isRecord(frame) ? frame["rotation"] : undefined
  if (isRecord(rotation)) {
    const { w, x, y, z } = rotation
    if (isNumber(x) && isNumber(y) && isNumber(z) && isNumber(w) && !isNormalizedRotation({ x, y, z, w })) {
      out.push(`Group ${index}'s frame has a non-normalized rotation.`)
    }
  }
  const scale = isRecord(frame) ? frame["scale3D"] : undefined
  if (isRecord(scale) && [scale["x"], scale["y"], scale["z"]].includes(0)) {
    out.push(`Group ${index}'s frame has a scale of 0 on an axis, which makes the game open a blank map.`)
  }
  return out
}

const editorStateProblems = (map: MapFile): Array<string> => {
  if (map.editorState === undefined) return []
  const { groups, pivots, version } = map.editorState
  const out: Array<string> = []
  if (version !== EDITOR_STATE_VERSION) out.push(`The editor state is version ${version}; the game reads version 1.`)
  const pivoted = new Set<number>()
  for (const { itemIndex, pivot } of pivots) {
    if (pivoted.has(itemIndex)) out.push(`Item ${itemIndex} has two pivots.`)
    pivoted.add(itemIndex)
    if (!PIVOT_CHOICES.has(pivot.choice)) {
      out.push(`Item ${itemIndex}'s pivot "${pivot.choice}" isn't one of the game's.`)
    }
  }
  groups.forEach((group, index) => out.push(...groupProblems(group, index)))
  return out
}

/** The problems beyond the rules in `limits.ts`. Rules about classes, properties and meshes need a catalog. */
export const gameRuleProblems = (map: MapFile, catalog: CatalogIndex | null): ReadonlyArray<string> => {
  const byName = new Map([...catalog?.pieceByClass.values() ?? []].map((p) => [p.className, p]))
  const json = jsonProblem(map, 0)
  const out = [...json === undefined ? [] : [json], ...levelProblems(map)]
  map.items.forEach((item, index) => {
    const piece = byName.get(classNameOf(item.actorToSpawn))
    if (catalog !== null) out.push(...classProblem(item, index, piece))
    out.push(...propertyProblems(item, index, piece), ...meshProblems(item, index, piece, catalog))
  })
  out.push(...editorStateProblems(map))
  return out
}

const hasZero = (scale: Triple) => scale.includes(0)

const prefabItemProblems = (item: PrefabItem, index: number, piece: CatalogPiece | undefined): Array<string> => {
  const name = classNameOf(item.class)
  if (name === PLAYER_START) return [PREFAB_REFUSALS.playerStart]
  const wrongProperty = piece?.properties !== undefined && Object.entries(item.properties).some(([property, value]) => {
    const list = piece.properties?.find((known) => known.name === property)?.list
    return list === undefined || (list !== null && !validPrefabValue(list, value))
  })
  return hasZero(item.transform.scale) || wrongProperty ? [PREFAB_REFUSALS.item(index)] : []
}

/** A flat `properties` value of the type its list holds. */
const validPrefabValue = (list: PropertyList, value: unknown): boolean => {
  switch (list) {
    case "boolProperties":
      return typeof value === "boolean"
    case "floatProperties":
      return typeof value === "number"
    case "intProperties":
      return Number.isInteger(value)
    default:
      return typeof value === "string"
  }
}

/**
 * What the game refuses in a prefab file that decodes, as it says so (docs/qa/groups-prefabs.md § Hand-written prefabs).
 * Each stops `spawnprefab` with nothing changed. Rules about classes and properties need a catalog.
 */
export const prefabProblems = (prefab: PrefabFile, catalog: CatalogIndex | null): ReadonlyArray<string> => {
  const { group, items } = prefab
  const out: Array<string> = []
  if (items.length < PREFAB_ITEMS.min || items.length > PREFAB_ITEMS.max || hasZero(group.scale)) {
    out.push(PREFAB_REFUSALS.document)
  }
  if (group.name !== undefined && !GROUP_NAME.test(group.name)) out.push(PREFAB_REFUSALS.groupName)
  const byName = new Map([...catalog?.pieceByClass.values() ?? []].map((p) => [p.className, p]))
  items.forEach((item, index) => {
    const name = classNameOf(item.class)
    const piece = byName.get(name)
    if (catalog !== null && piece === undefined && name !== PLAYER_START) out.push(PREFAB_REFUSALS.itemClass)
    else out.push(...prefabItemProblems(item, index, piece))
  })
  return [...new Set(out)]
}
