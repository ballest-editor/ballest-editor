import { DateTime, Layer, ManagedRuntime } from "effect"
import { CatalogLoader } from "./CatalogLoader"
import { KeybindStore } from "./KeybindStore"
import { MapCodec } from "./MapCodec"
import { MapExporter } from "./MapExporter"
import { MapPrefsStore } from "./MapPrefsStore"
import { MaterialLibrary } from "./MaterialLibrary"
import { SettingsStore } from "./SettingsStore"

export const AppLayer = Layer.mergeAll(
  MapCodec.layer,
  CatalogLoader.layer,
  KeybindStore.layer,
  MapExporter.layer,
  MapPrefsStore.layer,
  MaterialLibrary.layer,
  SettingsStore.layer,
  DateTime.layerCurrentZoneLocal
)

/** The single bridge from React into Effect. */
export const runtime = ManagedRuntime.make(AppLayer)
export type AppServices = Layer.Success<typeof AppLayer>
