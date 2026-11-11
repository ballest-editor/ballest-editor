import { Context, type Effect } from "effect"
import type * as Electron from "electron"

export class ElectronMenu extends Context.Service<ElectronMenu, {
  /** No application menu: none of Electron's default shortcuts (reload, close, DevTools, zoom) apply. */
  readonly remove: Effect.Effect<void>
  /** Replaces Electron's default menu, so only this template's shortcuts apply. */
  readonly set: (template: Array<Electron.MenuItemConstructorOptions>) => Effect.Effect<void>
}>()("ballest/desktop/electron/ElectronMenu") {}
