/**
 * Constructors for map data: new maps, items placed from the palette, the player start.
 * Everything here returns plain values typed by the MapFile schemas; the round-trip and
 * factory tests decode them again to prove they satisfy the schema.
 */
import { mapFileNameOf, NAME_RULE, SYSTEM_LEVEL_NAME, userLevelNameOf } from "@ballest/contracts"
import { DateTime, Effect } from "effect"
import type { CatalogPiece } from "./Catalog"
import type { Vec3 } from "./coords"
import { refusesMeshComponents } from "./gameRules"
import { defaultProperties } from "./itemProperties"
import { DEFAULT_GOAL, DEFAULT_PLAYER_START } from "./level"
import {
  type EditorState,
  GOAL_CLASS,
  type Item,
  type ItemTransform,
  type MapFile,
  MESH_COMPONENT_TAG,
  type MeshComponent,
  objectPathOf,
  PLAYER_START_CLASS,
  type PropertyList
} from "./MapFile"
import { SURFACE_PROPERTY } from "./surface"
import { rotatorToQuat } from "./ueMath"

/** Whether a light casts shadows: the one property a new placement doesn't start at its class default. */
const LIGHT_SHADOWS = "bLightCastsShadows"

/** `YYYY.MM.DD-HH.MM.SS`, the game's `createdAt` format. */
export const formatCreatedAt = (parts: DateTime.DateTime.Parts): string => {
  const p2 = (n: number) => String(n).padStart(2, "0")
  return `${parts.year}.${p2(parts.month)}.${p2(parts.day)}-${p2(parts.hour)}.${p2(parts.minute)}.${p2(parts.second)}`
}

/** The time now as `createdAt` holds it: in UTC, as the game writes it and `createdAtIso` reads it. */
export const currentCreatedAt: Effect.Effect<string> = Effect.map(
  DateTime.now,
  (now) => formatCreatedAt(DateTime.toPartsUtc(now))
)

/** Map and creator names and the file name they make: the same rules main applies (`@ballest/contracts`). */
export { isValidName, mapFileNameOf, NAME_RULE, userLevelNameOf } from "@ballest/contracts"

/** `NAME_RULE` starting a sentence. */
export const NAME_RULE_SENTENCE = `${NAME_RULE[0]?.toUpperCase() ?? ""}${NAME_RULE.slice(1)}`

/** A map file name without the game's prefix and extension (`Big Loop_Isaac`): the name and creator inside it. */
export const userLevelNameOfFile = (fileName: string): string => {
  const prefix = `${SYSTEM_LEVEL_NAME}&`
  return (fileName.startsWith(prefix) ? fileName.slice(prefix.length) : fileName).replace(/\.balledit$/i, "")
}

/**
 * The map's name from its file name (`Big Loop` from `Map_LevelEditorMain&Big Loop_Isaac.balledit`), for tabs, lists
 * and notifications: the creator is the file's, not something to repeat everywhere. Names hold no `_` (`NAME_RULE`),
 * so the last one is the separator; a file without one is shown whole.
 */
export const mapLabelOf = (fileName: string): string => {
  const full = userLevelNameOfFile(fileName)
  const at = full.lastIndexOf("_")
  return at > 0 ? full.slice(0, at) : full
}

/** `name` with what `NAME_RULE` doesn't allow taken out: `asdf (v2)` is saved as `asdf v2`. */
export const savableNameOf = (name: string): string => name.replace(/[^\p{L}\p{N} ]/gu, "").replace(/ +/g, " ").trim()

/** The first of `<base><separator>2`, `<base><separator>3`, ... that isn't taken. */
export const nextNumberedName = (base: string, separator: string, isTaken: (name: string) => boolean): string => {
  for (let n = 2;; n++) {
    const name = `${base}${separator}${n}`
    if (!isTaken(name)) return name
  }
}

/** The first of `<name> 2`, `<name> 3`, ... whose file name isn't `taken`: the name a copy gets. */
export const copyNameOf = (displayName: string, creatorName: string, taken: ReadonlySet<string>): string =>
  nextNumberedName(displayName.replace(/ \d+$/, ""), " ", (name) => taken.has(mapFileNameOf(name, creatorName)))

/** `base`, else `base 2`, `base 3`... whichever comes first that isn't taken. */
export const nextFreeName = (base: string, isTaken: (name: string) => boolean): string =>
  isTaken(base) ? nextNumberedName(base, " ", isTaken) : base

/** The name a new map goes by until its first Save: Untitled, or the next number the open tabs (`taken`) leave free. */
export const untitledNameOf = (taken: ReadonlySet<string>): string =>
  nextFreeName("Untitled", (name) => taken.has(name))

export const identityTransform = (translation = { x: 0, y: 0, z: 0 }): ItemTransform => ({
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  translation,
  scale3D: { x: 1, y: 1, z: 1 }
})

const emptyProperties = {
  boolProperties: [],
  floatProperties: [],
  intProperties: [],
  textProperties: [],
  nameProperties: [],
  stringProperties: []
} as const

/** The player start and goal as 0.4.1 saves them: no properties of their own, the item surface at none. */
const objectiveProperties = {
  ...emptyProperties,
  intProperties: [{ currentValue: 0, propertyName: SURFACE_PROPERTY, propertyType: "Integer" }]
}

export const meshComponentFor = (meshAssetPath: string, materials: ReadonlyArray<string>): MeshComponent => ({
  meshComponentTag: MESH_COMPONENT_TAG,
  materials: materials.map((material, materialIndex) => ({ material, materialIndex })),
  meshAssetPath,
  materialAssetPaths: materials.map(objectPathOf)
})

/** The Main mesh component as the in-game editor writes it for a fresh piece: every slot at its default. */
export const mainMeshComponentOf = (piece: Pick<CatalogPiece, "meshAssetPath" | "materialSlots">): MeshComponent =>
  piece.meshAssetPath === null
    ? meshComponentFor("", [])
    : meshComponentFor(
      piece.meshAssetPath,
      [...piece.materialSlots].sort((a, b) => a.index - b.index).map((slot) =>
        qualifyMaterialPath(slot.defaultMaterial)
      )
    )

/**
 * Map files store materials class-qualified (`/Script/Engine.MaterialInstanceConstant'/Game/X.X'`);
 * the catalog may give bare object paths. In every sample, `MI_*` assets are
 * MaterialInstanceConstant and everything else is Material.
 */
export const qualifyMaterialPath = (path: string): string => {
  if (path.includes("'")) return path
  const name = path.slice(path.lastIndexOf("/") + 1)
  const cls = name.startsWith("MI_") ? "MaterialInstanceConstant" : "Material"
  return `/Script/Engine.${cls}'${path}'`
}

/**
 * The properties of a new placement: the class defaults, with a light's shadows off. The game's light component
 * (`bDisableShadowsOnNewPlacement`, set on every class with this property) does that when a light is placed. It's no
 * class default: a light that is pasted, or loaded from a file without the property, has them on.
 */
const placedProperties = (piece: CatalogPiece): Pick<Item, PropertyList> => {
  const properties = defaultProperties(piece)
  return {
    ...properties,
    boolProperties: properties.boolProperties.map((p) =>
      p.propertyName === LIGHT_SHADOWS ? { ...p, currentValue: false } : p
    )
  }
}

/**
 * An item exactly as the in-game editor writes a freshly placed piece. Pieces whose Main
 * component has no mesh (air vent, checkpoint strip) get the empty mesh component the
 * game writes for them, and every exposed property is written at its placement default. The classes the game only
 * reloads without components get none, unlike its own saves: it draws them from the class.
 */
export const itemFromPiece = (piece: CatalogPiece, transform: ItemTransform): Item => ({
  actorToSpawn: piece.classPath,
  itemTransform: transform,
  meshComponents: refusesMeshComponents(piece.classPath) ? [] : [mainMeshComponentOf(piece)],
  bIsBaseItem: false,
  ...placedProperties(piece)
})

/**
 * Default transform for a piece placed at `translation` (UE cm): the item transform is
 * the Main component's world transform, so an unrotated actor gets Main's relative
 * rotation and scale (e.g. the player start's 0.2765).
 */
export const placementTransform = (piece: CatalogPiece, translation: Vec3): ItemTransform => {
  const rel = piece.mainRelativeTransform
  if (piece.classPath === PLAYER_START_CLASS) return playerStartTransform({ ...translation })
  if (rel === undefined || rel === null) return identityTransform({ ...translation })
  return {
    rotation: { ...rotatorToQuat(rel.rotation) },
    translation: {
      x: translation.x + rel.location[0],
      y: translation.y + rel.location[1],
      z: translation.z + rel.location[2]
    },
    scale3D: { x: rel.scale[0], y: rel.scale[1], z: rel.scale[2] }
  }
}

const PLAYER_START_MESH = "/Game/Maps/_GENERATED/PC/SM_Start_Fixed.SM_Start_Fixed"
const GOAL_YELLOW = "/Script/Engine.MaterialInstanceConstant'/Game/Art/Stadium/Arena/MI_GoalYellow.MI_GoalYellow'"
/** The in-game editor saves new player starts at this scale (20/20 samples; the catalog rounds it to 0.2765). */
const PLAYER_START_SCALE = 0.276538

const playerStartTransform = (translation: Vec3 = DEFAULT_PLAYER_START): ItemTransform => ({
  ...identityTransform({ ...translation }),
  scale3D: { x: PLAYER_START_SCALE, y: PLAYER_START_SCALE, z: PLAYER_START_SCALE }
})

export const playerStartItem = (piece?: CatalogPiece): Item =>
  piece?.classPath === PLAYER_START_CLASS
    ? itemFromPiece(piece, playerStartTransform())
    : {
      actorToSpawn: PLAYER_START_CLASS,
      itemTransform: playerStartTransform(),
      meshComponents: [meshComponentFor(PLAYER_START_MESH, [GOAL_YELLOW])],
      bIsBaseItem: false,
      ...objectiveProperties
    }

const GOAL_MESH = "/Game/Maps/_GENERATED/PC/SM_GoalRing.SM_GoalRing"
/**
 * The level's goal ring, as every untouched in-game save writes it: pitched 90° so the ring
 * stands upright facing the player start, at its Main component's scale 1.5.
 */
export const goalItem = (): Item => ({
  actorToSpawn: GOAL_CLASS,
  itemTransform: {
    // The game's own bits: y is exactly -SQRT1_2, w one ulp above it.
    rotation: { x: 0, y: -Math.SQRT1_2, z: 0, w: 0.7071067811865477 },
    translation: { ...DEFAULT_GOAL },
    scale3D: { x: 1.5, y: 1.5, z: 1.5 }
  },
  meshComponents: [meshComponentFor(GOAL_MESH, [GOAL_YELLOW])],
  bIsBaseItem: false,
  ...objectiveProperties
})

export const defaultEditorState = (): EditorState => ({
  version: 1,
  groups: [],
  pivots: [],
  bHasCamera: false,
  cameraLocation: { x: 0, y: 0, z: 0 },
  cameraRotation: { pitch: 0, yaw: 0, roll: 0 }
})

export interface NewMapOptions {
  readonly displayName: string
  readonly creatorName: string
  readonly createdAt: string
  readonly playerStartPiece?: CatalogPiece | undefined
}

/**
 * A new, unvalidated map with what a fresh in-game map starts with: the one player start the
 * game requires, then the goal ring, both where the level puts them. Defaults match fresh
 * in-game saves.
 */
export const newMapFile = (options: NewMapOptions): MapFile => ({
  worldSettings: {
    directionalLight: { timeOfDay: 7.299709320068359, brightness: 12 },
    metaData: [{ title: "Foo", descriptor: "Bar" }],
    levelData: {
      systemLevelName: SYSTEM_LEVEL_NAME,
      userLevelName: userLevelNameOf(options.displayName, options.creatorName),
      levelDifficulty: "Beginner",
      levelDescription: "",
      uploaderOnlyLevelPreviewImagePath: "",
      bValidated: false,
      mapTags: { gameplayTags: [] },
      medalTimesByIndex: [0],
      createdAt: options.createdAt,
      creatorName: options.creatorName,
      levelDisplayName: options.displayName,
      levelPublishedFileId: -1
    },
    skylightIntensity: 1,
    directionalLightAngle: -20.6474552154541
  },
  items: [playerStartItem(options.playerStartPiece), goalItem()],
  editorState: defaultEditorState()
})
