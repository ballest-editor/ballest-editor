import { Context, Effect, Layer } from "effect"
import * as Electron from "electron"

export class ElectronMenu extends Context.Service<ElectronMenu, {
  /** No application menu: none of Electron's default shortcuts (reload, close, DevTools, zoom) apply. */
  readonly remove: Effect.Effect<void>
}>()("ballest/desktop/electron/ElectronMenu") {
  static readonly layer = Layer.succeed(
    ElectronMenu,
    ElectronMenu.of({ remove: Effect.sync(() => Electron.Menu.setApplicationMenu(null)) })
  )
}
