import { Context, Effect, Layer, Option, Schema } from "effect"
import { KeyValueStore } from "effect/persistence"
import { defaultSettings, mergeSettings, Settings } from "../domain/Settings"
import { SettingsStoreError } from "./errors"

export const SETTINGS_STORAGE_KEY = "ballest-editor.settings.v1"

/** Editor settings in localStorage (memory when unavailable). Keybinds live in KeybindStore. */
export class SettingsStore extends Context.Service<SettingsStore, {
  /** Saved settings merged over the defaults; corrupt data falls back per field. */
  readonly load: Effect.Effect<Settings, SettingsStoreError>
  save(settings: Settings): Effect.Effect<void, SettingsStoreError>
  readonly reset: Effect.Effect<Settings, SettingsStoreError>
}>()("ballest/services/SettingsStore") {
  static readonly layerNoDeps = Layer.effect(
    SettingsStore,
    Effect.gen(function*() {
      const kv = yield* KeyValueStore.KeyValueStore
      const toError = (error: { readonly message: string }) => new SettingsStoreError({ message: error.message })
      const encode = Schema.encodeEffect(Schema.fromJsonString(Settings))

      const load = kv.get(SETTINGS_STORAGE_KEY).pipe(
        Effect.mapError(toError),
        Effect.map((text) =>
          Option.match(Option.fromUndefinedOr(text), {
            onNone: () => defaultSettings,
            onSome: (raw) => {
              try {
                return mergeSettings(JSON.parse(raw))
              } catch {
                return defaultSettings
              }
            }
          })
        ),
        Effect.withSpan("SettingsStore.load")
      )

      const save = Effect.fn("SettingsStore.save")(function*(settings: Settings) {
        const text = yield* encode(settings).pipe(Effect.mapError(toError))
        yield* kv.set(SETTINGS_STORAGE_KEY, text).pipe(Effect.mapError(toError))
      })

      const reset = kv.remove(SETTINGS_STORAGE_KEY).pipe(Effect.mapError(toError), Effect.as(defaultSettings))

      return SettingsStore.of({ load, save, reset })
    })
  )

  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide(
      typeof globalThis.localStorage === "undefined"
        ? KeyValueStore.layerMemory
        : KeyValueStore.layerStorage(() => globalThis.localStorage)
    )
  )

  static readonly layerTest = this.layerNoDeps.pipe(Layer.provideMerge(KeyValueStore.layerMemory))
}
