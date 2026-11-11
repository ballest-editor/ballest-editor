import { Effect, Layer, Option } from "effect"
import * as Electron from "electron"
import { STEAM_LAUNCH_URL } from "../../game/locations"
import { ElectronShell, parseExternalUrl } from "../ElectronShell"

const openUrl = (url: string) => Effect.promise(() => Electron.shell.openExternal(url).then(() => true, () => false))

export const layerElectronShell = Layer.succeed(
  ElectronShell,
  ElectronShell.of({
    openExternal: (raw) =>
      Option.match(parseExternalUrl(raw), {
        onNone: () => Effect.succeed(false),
        onSome: openUrl
      }),
    launchGame: openUrl(STEAM_LAUNCH_URL),
    // `openPath` resolves with an error message, empty on success.
    openFolder: (path) => Effect.promise(() => Electron.shell.openPath(path).then((error) => error === "", () => false))
  })
)
