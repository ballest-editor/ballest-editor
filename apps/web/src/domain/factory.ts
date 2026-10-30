/**
 * Constructors for map data: new maps, items placed from the palette, the player start.
 * Everything here returns plain values typed by the MapFile schemas; the round-trip and
 * factory tests decode them again to prove they satisfy the schema.
 */
import { DateTime, Effect } from "effect"
import type { CatalogPiece } from "./Catalog"
import type { Vec3 } from "./coords"
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
  SYSTEM_LEVEL_NAME
} from "./MapFile"
import { rotatorToQuat } from "./ueMath"

/** `YYYY.MM.DD-HH.MM.SS`, the game's `createdAt` format. */
export const formatCreatedAt = (parts: DateTime.DateTime.Parts): string => {
  const p2 = (n: number) => String(n).padStart(2, "0")
  return `${parts.year}.${p2(parts.month)}.${p2(parts.day)}-${p2(parts.hour)}.${p2(parts.minute)}.${p2(parts.second)}`
}

/** Local wall-clock time (the CurrentTimeZone service), formatted for `createdAt`. */
export const currentCreatedAt: Effect.Effect<string, never, DateTime.CurrentTimeZone> = Effect.map(
  DateTime.nowInCurrentZone,
  (now) => formatCreatedAt(DateTime.toParts(now))
)

/**
 * Map and creator names: letters, digits and spaces only. The game joins them with `_`
 * into `userLevelName` and the file name, so `_` (and anything Windows rejects in a file
 * name) is out.
 */
export const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ]*$/u
export const isValidName = (name: string): boolean => NAME_PATTERN.test(name) && name.trim() === name
export const NAME_RULE = "letters, digits and spaces only"

export const userLevelNameOf = (displayName: string, creatorName: string): string => `${displayName}_${creatorName}`

export const mapFileNameOf = (displayName: string, creatorName: string): string =>
  `${SYSTEM_LEVEL_NAME}&${userLevelNameOf(displayName, creatorName)}.balledit`

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

export const meshComponentFor = (meshAssetPath: string, materials: ReadonlyArray<string>): MeshComponent => ({
  meshComponentTag: MESH_COMPONENT_TAG,
  materials: materials.map((material, materialIndex) => ({ material, materialIndex })),
  meshAssetPath,
  materialAssetPaths: materials.map(objectPathOf)
})

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
 * An item exactly as the in-game editor writes a freshly placed piece. Pieces whose Main
 * component has no mesh (air vent, checkpoint strip) get the empty mesh component the
 * game writes for them, and every exposed property is written at its class default.
 */
export const itemFromPiece = (piece: CatalogPiece, transform: ItemTransform): Item => ({
  actorToSpawn: piece.classPath,
  itemTransform: transform,
  meshComponents: [
    piece.meshAssetPath === null
      ? meshComponentFor("", [])
      : meshComponentFor(
        piece.meshAssetPath,
        [...piece.materialSlots].sort((a, b) => a.index - b.index).map((slot) =>
          qualifyMaterialPath(slot.defaultMaterial)
        )
      )
  ],
  bIsBaseItem: false,
  ...defaultProperties(piece)
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
      ...emptyProperties
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
  ...emptyProperties
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
