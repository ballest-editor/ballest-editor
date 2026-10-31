import { Context, Effect, Layer } from "effect"
import * as Electron from "electron"

export class ElectronDialog extends Context.Service<ElectronDialog, {
  /** A blocking native error box; safe to call before `ready`, so fatal startup errors use it. */
  readonly showErrorBox: (title: string, content: string) => Effect.Effect<void>
}>()("ballest/desktop/electron/ElectronDialog") {
  static readonly layer = Layer.succeed(
    ElectronDialog,
    ElectronDialog.of({
      showErrorBox: (title, content) => Effect.sync(() => Electron.dialog.showErrorBox(title, content))
    })
  )
}
