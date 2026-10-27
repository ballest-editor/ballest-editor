import { Schema } from "effect"

export class MapDecodeError extends Schema.TaggedError<MapDecodeError>()("MapDecodeError", {
  message: Schema.String
}) {}

export class MapEncodeError extends Schema.TaggedError<MapEncodeError>()("MapEncodeError", {
  message: Schema.String
}) {}

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
