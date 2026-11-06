import { Schema } from "effect"

export class MapDecodeError extends Schema.TaggedError<MapDecodeError>()("MapDecodeError", {
  message: Schema.String
}) {}

export class MapEncodeError extends Schema.TaggedError<MapEncodeError>()("MapEncodeError", {
  message: Schema.String
}) {}

export class SidecarDecodeError extends Schema.TaggedError<SidecarDecodeError>()("SidecarDecodeError", {
  message: Schema.String
}) {}

/** A file that isn't the shape of a prefab, in the game's words with what was wrong after them. */
export class PrefabDecodeError extends Schema.TaggedError<PrefabDecodeError>()("PrefabDecodeError", {
  message: Schema.String
}) {}

/** A prefab of the right shape that the game wouldn't spawn. */
export class PrefabRefusedError extends Schema.TaggedError<PrefabRefusedError>()("PrefabRefusedError", {
  problems: Schema.Array(Schema.String)
}) {
  override get message(): string {
    return this.problems.join(" ")
  }
}

export class CatalogLoadError extends Schema.TaggedError<CatalogLoadError>()("CatalogLoadError", {
  url: Schema.String,
  message: Schema.String
}) {}

export class KeybindStoreError extends Schema.TaggedError<KeybindStoreError>()("KeybindStoreError", {
  message: Schema.String
}) {}

export class ExportValidationError extends Schema.TaggedError<ExportValidationError>()("ExportValidationError", {
  message: Schema.String
}) {}

export class GameKeybindsLoadError extends Schema.TaggedError<GameKeybindsLoadError>()("GameKeybindsLoadError", {
  url: Schema.String,
  message: Schema.String
}) {}

export class MaterialLibraryLoadError
  extends Schema.TaggedError<MaterialLibraryLoadError>()("MaterialLibraryLoadError", {
    url: Schema.String,
    message: Schema.String
  })
{}

export class SettingsStoreError extends Schema.TaggedError<SettingsStoreError>()("SettingsStoreError", {
  message: Schema.String
}) {}

export class MapPrefsStoreError extends Schema.TaggedError<MapPrefsStoreError>()("MapPrefsStoreError", {
  message: Schema.String
}) {}
