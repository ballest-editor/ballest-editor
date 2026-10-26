import { Context, Effect, Layer, Schema } from "effect"
import { type DerivedKeybinds, deriveKeybinds, GameKeybindsFile } from "../domain/GameKeybinds"
import type { FetchText } from "./CatalogLoader"
import { GameKeybindsLoadError } from "./errors"

export const GAME_KEYBINDS_URL = "/assets/keybinds.json"

const decodeFile = Schema.decodeUnknownEffect(GameKeybindsFile)

/** The game's default bindings (assets/keybinds.json), mapped onto editor actions. */
export class GameKeybinds extends Context.Service<GameKeybinds, {
  readonly fetch: Effect.Effect<GameKeybindsFile, GameKeybindsLoadError>
  /** Never fails: a missing/invalid file means every action uses its fallback. Logs the fallbacks. */
  readonly defaults: Effect.Effect<DerivedKeybinds>
}>()("ballest/services/GameKeybinds") {
  static readonly make = Effect.fnUntraced(function*(fetchText: FetchText, url: string = GAME_KEYBINDS_URL) {
    const fail = (message: string) => new GameKeybindsLoadError({ url, message })

    const fetchFile = Effect.gen(function*() {
      const response = yield* Effect.tryPromise({ try: () => fetchText(url), catch: (c) => fail(String(c)) })
      if (!response.ok) return yield* fail(`HTTP ${response.status}`)
      const text = yield* Effect.tryPromise({ try: () => response.text(), catch: (c) => fail(String(c)) })
      const json = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => fail("not JSON (keybinds.json missing?)") })
      return yield* decodeFile(json).pipe(Effect.mapError((e) => fail(e.message)))
    }).pipe(Effect.withSpan("GameKeybinds.fetch"))

    const defaults = yield* fetchFile.pipe(
      Effect.map(deriveKeybinds),
      Effect.catchTag("GameKeybindsLoadError", (error) =>
        Effect.logWarning(`Game keybinds unavailable (${error.message}); using editor fallbacks`).pipe(
          Effect.as(deriveKeybinds(undefined))
        )),
      Effect.tap((derived) =>
        derived.fellBack.length === 0
          ? Effect.void
          : Effect.logInfo(`Keybinds not defined by the game, using fallbacks: ${derived.fellBack.join(", ")}`)
      ),
      Effect.cached
    )

    return GameKeybinds.of({ fetch: fetchFile, defaults })
  })

  static readonly layer = Layer.effect(GameKeybinds, GameKeybinds.make((url) => globalThis.fetch(url)))

  /** For tests: serve `body` (or a 404 when undefined) instead of fetching. */
  static readonly layerFromText = (body: string | undefined) =>
    Layer.effect(
      GameKeybinds,
      GameKeybinds.make(() =>
        Promise.resolve({ ok: body !== undefined, status: body === undefined ? 404 : 200, text: () => Promise.resolve(body ?? "") })
      )
    )
}
