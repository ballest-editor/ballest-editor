/** UI-facing operations that run Effects through the single app runtime. */
import { Cause, Effect, Exit } from "effect"
import { currentCreatedAt, newMapFile } from "../domain/factory"
import type { Keybinds } from "../domain/Keybinds"
import { PLAYER_START_CLASS } from "../domain/MapFile"
import type { Settings } from "../domain/Settings"
import { CatalogLoader } from "../services/CatalogLoader"
import { KeybindStore } from "../services/KeybindStore"
import { MapCodec } from "../services/MapCodec"
import { MapExporter } from "../services/MapExporter"
import { MaterialLibrary } from "../services/MaterialLibrary"
import { type AppServices, runtime } from "../services/runtime"
import { SettingsStore } from "../services/SettingsStore"
import { useEditor } from "./store"

const run = async <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A | undefined> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const error = Cause.squash(exit.cause)
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error)
  useEditor.getState().notify("error", message)
  return undefined
}

export const loadCatalog = () =>
  run(
    Effect.gen(function*() {
      const loaded = yield* CatalogLoader.use((loader) => loader.load)
      useEditor.getState().setCatalog(loaded)
    })
  )

export const loadMaterials = () =>
  run(
    Effect.gen(function*() {
      const table = yield* MaterialLibrary.use((library) => library.load)
      useEditor.getState().setMaterialTable(table)
    })
  )

export const loadSettings = () =>
  run(
    Effect.gen(function*() {
      useEditor.getState().setSettings(yield* SettingsStore.use((store) => store.load))
    })
  )

/** Applies immediately, then persists. */
export const saveSettings = (settings: Settings) => {
  useEditor.getState().setSettings(settings)
  return run(
    Effect.gen(function*() {
      const store = yield* SettingsStore
      yield* store.save(settings)
    })
  )
}

export const loadKeybinds = () =>
  run(
    Effect.gen(function*() {
      const { keybinds, defaults } = yield* KeybindStore.use((store) => store.load)
      useEditor.getState().setKeybinds(keybinds, defaults)
    })
  )

export const saveKeybinds = (keybinds: Keybinds) =>
  run(
    Effect.gen(function*() {
      yield* KeybindStore.use((store) => store.save(keybinds))
      useEditor.getState().setKeybinds(keybinds)
    })
  )

export const resetKeybinds = () =>
  run(
    Effect.gen(function*() {
      const { keybinds, defaults } = yield* KeybindStore.use((store) => store.reset)
      useEditor.getState().setKeybinds(keybinds, defaults)
    })
  )

export const newMap = (displayName: string, creatorName: string) =>
  run(
    Effect.gen(function*() {
      const createdAt = yield* currentCreatedAt
      const catalog = useEditor.getState().catalog?.catalog
      const playerStartPiece = catalog?.pieces.find((p) => p.classPath === PLAYER_START_CLASS)
      useEditor.getState().loadMap(newMapFile({ displayName, creatorName, createdAt, playerStartPiece }), null)
    })
  )

export const importFile = (file: File) =>
  run(
    Effect.gen(function*() {
      const text = yield* Effect.promise(() => file.text())
      const map = yield* MapCodec.use((codec) => codec.decode(text))
      useEditor.getState().loadMap(map, file.name)
      useEditor.getState().notify("info", `Imported ${file.name} (${map.items.length} items)`)
    })
  )

export const exportMap = () =>
  run(
    Effect.gen(function*() {
      const { map } = useEditor.getState().doc
      const result = yield* MapExporter.use((exporter) => exporter.prepare(map))
      const url = URL.createObjectURL(result.blob)
      const a = document.createElement("a")
      a.href = url
      a.download = result.filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
      useEditor.getState().replaceMapSilently(result.map)
      useEditor.getState().notify("info", `Exported ${result.filename}`)
    })
  )
