import { Context, Effect, Layer, Schema } from "effect"
import { KeyValueStore } from "effect/persistence"
import { MapPrefs, parseMapPrefs } from "../domain/MapPrefs"
import { browserStorage } from "./browserStorage"
import { MapPrefsStoreError } from "./errors"

export const MAP_PREFS_STORAGE_KEY = "ballest-editor.maps.v1"

/** Per-map editor prefs (domain/MapPrefs) in localStorage (memory when unavailable), one JSON object for all maps. */
export class MapPrefsStore extends Context.Service<MapPrefsStore, {
  /** The map's saved prefs; empty when none are saved or the store is corrupt. */
  load(key: string): Effect.Effect<MapPrefs, MapPrefsStoreError>
  /** Replaces the map's prefs; empty prefs remove its entry. */
  save(key: string, prefs: MapPrefs): Effect.Effect<void, MapPrefsStoreError>
}>()("ballest/services/MapPrefsStore") {
  static readonly layerNoDeps = Layer.effect(
    MapPrefsStore,
    Effect.gen(function*() {
      const kv = yield* KeyValueStore.KeyValueStore
      const toError = (error: { readonly message: string }) => new MapPrefsStoreError({ message: error.message })
      const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, MapPrefs)))

      const loadAll = kv.get(MAP_PREFS_STORAGE_KEY).pipe(
        Effect.map((text): Record<string, MapPrefs> => {
          if (text === undefined) return {}
          try {
            return parseMapPrefs(JSON.parse(text))
          } catch {
            return {}
          }
        })
      )

      const load = Effect.fn("MapPrefsStore.load")(function*(key: string) {
        const all = yield* loadAll
        return Object.hasOwn(all, key) ? all[key] ?? {} : {}
      }, Effect.mapError(toError))

      const save = Effect.fn("MapPrefsStore.save")(function*(key: string, prefs: MapPrefs) {
        const { [key]: _previous, ...rest } = yield* loadAll
        const all = Object.keys(prefs).length === 0 ? rest : { ...rest, [key]: prefs }
        yield* kv.set(MAP_PREFS_STORAGE_KEY, yield* encode(all))
      }, Effect.mapError(toError))

      return MapPrefsStore.of({ load, save })
    })
  )

  static readonly layer = this.layerNoDeps.pipe(Layer.provide(browserStorage))

  static readonly layerTest = this.layerNoDeps.pipe(Layer.provideMerge(KeyValueStore.layerMemory))
}
