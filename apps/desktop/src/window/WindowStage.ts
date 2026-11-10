import { Context, Deferred, Effect, Layer } from "effect"

/**
 * When the welcome window becomes the editor (docs/DESKTOP.md § Other windows). The page asks once it has the project
 * open and is ready to show the editor (`showEditor`), so the window grows only then, and the page shows the editor
 * only once it has: what the user sees goes straight from the small welcome window to the editor at full size.
 */
export class WindowStage extends Context.Service<WindowStage, {
  /** The page is about to show the editor: completes once the window has grown into it (at once after the first). */
  readonly showEditor: Effect.Effect<void>
  /** For `DesktopWindow`: runs `grow` when the page first asks to show the editor, before that ask completes. */
  readonly whenEditorShown: (grow: Effect.Effect<void>) => Effect.Effect<void>
}>()("ballest/desktop/window/WindowStage") {
  static readonly make = Effect.gen(function*() {
    const asked = yield* Deferred.make<void>()
    const grown = yield* Deferred.make<void>()
    return WindowStage.of({
      showEditor: Deferred.succeed(asked, undefined).pipe(Effect.andThen(Deferred.await(grown))),
      whenEditorShown: (grow) =>
        Deferred.await(asked).pipe(
          Effect.andThen(grow),
          Effect.ensuring(Deferred.succeed(grown, undefined))
        )
    })
  })

  static readonly layer = Layer.effect(WindowStage, WindowStage.make)
}
