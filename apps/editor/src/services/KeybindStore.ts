import { Context, Effect, Layer, Option } from "effect"
import { KeyValueStore } from "effect/persistence"
import type { DerivedKeybinds } from "../domain/GameKeybinds"
import { type Keybinds, mergeKeybinds, StoredKeybinds } from "../domain/Keybinds"
import { KeybindStoreError } from "./errors"
import { GameKeybinds } from "./GameKeybinds"

export const KEYBINDS_STORAGE_KEY = "ballest-editor.keybinds.v4"

export interface LoadedKeybinds {
  readonly keybinds: Keybinds
  readonly defaults: DerivedKeybinds
}

/** User overrides (localStorage) on top of the game's defaults. */
export class KeybindStore extends Context.Service<KeybindStore, {
  /** Saved bindings merged over the defaults. Corrupt data is ignored (defaults win). */
  readonly load: Effect.Effect<LoadedKeybinds, KeybindStoreError>
  save(keybinds: Keybinds): Effect.Effect<void, KeybindStoreError>
  readonly reset: Effect.Effect<LoadedKeybinds, KeybindStoreError>
}>()("ballest/services/KeybindStore") {
  static readonly layerNoDeps = Layer.effect(
    KeybindStore,
    Effect.gen(function*() {
      const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, StoredKeybinds)
      const game = yield* GameKeybinds
      const toError = (error: { readonly message: string }) => new KeybindStoreError({ message: error.message })

      const load = Effect.gen(function*() {
        const defaults = yield* game.defaults
        const stored = yield* store.get(KEYBINDS_STORAGE_KEY).pipe(
          Effect.catchTag("SchemaError", (error) =>
            Effect.logWarning(`Ignoring saved keybinds: ${error.message}`).pipe(Effect.as(Option.none()))
          ),
          Effect.mapError(toError)
        )
        const keybinds = Option.match(stored, {
          onNone: () => defaults.keybinds,
          onSome: (s) => mergeKeybinds(s, defaults.keybinds)
        })
        return { keybinds, defaults } satisfies LoadedKeybinds
      }).pipe(Effect.withSpan("KeybindStore.load"))

      const save = Effect.fn("KeybindStore.save")(function*(keybinds: Keybinds) {
        yield* store.set(KEYBINDS_STORAGE_KEY, keybinds).pipe(Effect.mapError(toError))
      })

      const reset = store.remove(KEYBINDS_STORAGE_KEY).pipe(
        Effect.mapError(toError),
        Effect.andThen(game.defaults),
        Effect.map((defaults) => ({ keybinds: defaults.keybinds, defaults })),
        Effect.withSpan("KeybindStore.reset")
      )

      return KeybindStore.of({ load, save, reset })
    })
  )

  /** Browser localStorage; in-memory when there is none (SSR, tests). */
  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide([
      GameKeybinds.layer,
      typeof globalThis.localStorage === "undefined"
        ? KeyValueStore.layerMemory
        : KeyValueStore.layerStorage(() => globalThis.localStorage)
    ])
  )

  /** In-memory storage with the given game keybinds file (undefined = missing). */
  static readonly layerTest = (gameKeybindsJson?: string) =>
    this.layerNoDeps.pipe(
      Layer.provideMerge(Layer.mergeAll(KeyValueStore.layerMemory, GameKeybinds.layerFromText(gameKeybindsJson)))
    )
}
