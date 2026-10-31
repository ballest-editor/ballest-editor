import { Context, Effect, Layer, Option } from "effect"
import * as Electron from "electron"
import { STEAM_LAUNCH_URL } from "../game/locations"

/** Only web links leave the app; anything else (file:, custom schemes) could launch arbitrary handlers. */
export const parseExternalUrl = (raw: string): Option.Option<string> => {
  const url = URL.parse(raw)
  return url !== null && (url.protocol === "https:" || url.protocol === "http:") ? Option.some(url.href) : Option.none()
}

const openUrl = (url: string) => Effect.promise(() => Electron.shell.openExternal(url).then(() => true, () => false))

export class ElectronShell extends Context.Service<ElectronShell, {
  /** Opens an http(s) URL in the default browser; false when refused or the OS failed to open it. */
  readonly openExternal: (url: string) => Effect.Effect<boolean>
  /** Asks Steam to start the game (`steam://rungameid/3339810`); false when no handler took the link. */
  readonly launchGame: Effect.Effect<boolean>
  /** Shows a folder in the file manager; false when it failed to open. */
  readonly openFolder: (path: string) => Effect.Effect<boolean>
}>()("ballest/desktop/electron/ElectronShell") {
  static readonly layer = Layer.succeed(
    ElectronShell,
    ElectronShell.of({
      openExternal: (raw) =>
        Option.match(parseExternalUrl(raw), {
          onNone: () => Effect.succeed(false),
          onSome: openUrl
        }),
      launchGame: openUrl(STEAM_LAUNCH_URL),
      // `openPath` resolves with an error message, empty on success.
      openFolder: (path) =>
        Effect.promise(() => Electron.shell.openPath(path).then((error) => error === "", () => false))
    })
  )
}
