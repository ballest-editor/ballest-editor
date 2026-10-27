/**
 * Schemas for the game's map JSON (`.balledit` / `.ballmap`). See docs/FORMAT.md.
 *
 * Every object is an "open" struct (see schema.ts): known fields are declared in the order
 * the game writes them, and anything we don't model survives import -> export.
 */
import { Schema } from "effect"
import { open } from "./schema"

// ---------------------------------------------------------------------------
// Math

export class Vector3 extends Schema.Opaque<Vector3>()(
  open({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite })
) {}

export class Quat extends Schema.Opaque<Quat>()(
  open({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite, w: Schema.Finite })
) {}

export class ItemTransform extends Schema.Opaque<ItemTransform>()(
  open({ rotation: Quat, translation: Vector3, scale3D: Vector3 })
) {}

// ---------------------------------------------------------------------------
// Items

export class MaterialSlot extends Schema.Opaque<MaterialSlot>()(
  open({ material: Schema.String, materialIndex: Schema.Int })
) {}

/**
 * Current saves write `meshComponentTag, materials, meshAssetPath, materialAssetPaths`.
 * Older Workshop maps write `meshComponent, meshComponentTag, materials` instead.
 */
export class MeshComponent extends Schema.Opaque<MeshComponent>()(
  open({
    meshComponent: Schema.optionalKey(Schema.String),
    meshComponentTag: Schema.String,
    materials: Schema.Array(MaterialSlot),
    meshAssetPath: Schema.optionalKey(Schema.String),
    materialAssetPaths: Schema.optionalKey(Schema.Array(Schema.String))
  })
) {}

const property = <S extends Schema.Top>(value: S) =>
  open({ currentValue: value, propertyName: Schema.String, propertyType: Schema.String })

export const BoolProperty = property(Schema.Boolean)
export const FloatProperty = property(Schema.Finite)
export const IntProperty = property(Schema.Int)
// No samples contain text/name/string properties yet; keep their values untyped.
export const UnknownProperty = property(Schema.Unknown)

export class Item extends Schema.Opaque<Item>()(
  open({
    actorToSpawn: Schema.String,
    itemTransform: ItemTransform,
    meshComponents: Schema.Array(MeshComponent),
    bIsBaseItem: Schema.Boolean,
    boolProperties: Schema.Array(BoolProperty),
    floatProperties: Schema.Array(FloatProperty),
    intProperties: Schema.Array(IntProperty),
    textProperties: Schema.Array(UnknownProperty),
    nameProperties: Schema.Array(UnknownProperty),
    stringProperties: Schema.Array(UnknownProperty)
  })
) {}

// ---------------------------------------------------------------------------
// World settings

export class LevelData extends Schema.Opaque<LevelData>()(
  open({
    systemLevelName: Schema.String,
    userLevelName: Schema.String,
    levelDifficulty: Schema.String,
    levelDescription: Schema.String,
    uploaderOnlyLevelPreviewImagePath: Schema.String,
    bValidated: Schema.Boolean,
    mapTags: open({ gameplayTags: Schema.Array(open({ tagName: Schema.String })) }),
    medalTimesByIndex: Schema.Array(Schema.Finite),
    createdAt: Schema.String,
    creatorName: Schema.String,
    levelDisplayName: Schema.String,
    levelPublishedFileId: Schema.Int
  })
) {}

export class WorldSettings extends Schema.Opaque<WorldSettings>()(
  open({
    directionalLight: open({ timeOfDay: Schema.Finite, brightness: Schema.Finite }),
    metaData: Schema.Array(open({ title: Schema.String, descriptor: Schema.String })),
    levelData: LevelData,
    skylightIntensity: Schema.optionalKey(Schema.Finite),
    directionalLightAngle: Schema.optionalKey(Schema.Finite)
  })
) {}

// ---------------------------------------------------------------------------
// Editor state (drafts only)

export class ItemPivot extends Schema.Opaque<ItemPivot>()(
  open({
    itemIndex: Schema.Int,
    pivot: open({ choice: Schema.String, localPosition: Vector3 })
  })
) {}

export class EditorState extends Schema.Opaque<EditorState>()(
  open({
    version: Schema.Int,
    groups: Schema.Array(Schema.Unknown),
    pivots: Schema.Array(ItemPivot),
    bHasCamera: Schema.Boolean,
    cameraLocation: Vector3,
    cameraRotation: open({ pitch: Schema.Finite, yaw: Schema.Finite, roll: Schema.Finite })
  })
) {}

// ---------------------------------------------------------------------------
// File

export class MapFile extends Schema.Opaque<MapFile>()(
  open({
    worldSettings: WorldSettings,
    items: Schema.Array(Item),
    editorState: Schema.optionalKey(EditorState)
  })
) {}

// ---------------------------------------------------------------------------
// Constants

export const SYSTEM_LEVEL_NAME = "Map_LevelEditorMain"
export const MESH_COMPONENT_TAG = "SKGMapEditor"
export const PLAYER_START_CLASS =
  "/Script/Engine.BlueprintGeneratedClass'/Game/MapItems/PlayerStart/MP_PlayerStart.MP_PlayerStart_C'"

export const isPlayerStart = (item: Item): boolean => item.actorToSpawn === PLAYER_START_CLASS

/** `/Script/Engine.MaterialInstanceConstant'/Game/X.X'` -> `/Game/X.X` (as the game writes `materialAssetPaths`). */
export const objectPathOf = (classQualifiedPath: string): string => {
  const match = /^[^']*'(.*)'$/.exec(classQualifiedPath)
  return match?.[1] ?? classQualifiedPath
}

/** `/Script/Engine.BlueprintGeneratedClass'/Game/.../BP_X.BP_X_C'` -> `BP_X`. */
export const classNameOf = (actorToSpawn: string): string => {
  const objectPath = objectPathOf(actorToSpawn)
  const last = objectPath.slice(objectPath.lastIndexOf(".") + 1)
  return last.endsWith("_C") ? last.slice(0, -2) : last
}
