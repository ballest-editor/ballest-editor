import { Context, Effect, Layer, Option } from "effect"
import * as Electron from "electron"

/** Only web links leave the app; anything else (file:, custom schemes) could launch arbitrary handlers. */
export const parseExternalUrl = (raw: string): Option.Option<string> => {
  const url = URL.parse(raw)
  return url !== null && (url.protocol === "https:" || url.protocol === "http:") ? Option.some(url.href) : Option.none()
}

export class ElectronShell extends Context.Service<ElectronShell, {
  /** Opens an http(s) URL in the default browser; false when refused or the OS failed to open it. */
  readonly openExternal: (url: string) => Effect.Effect<boolean>
}>()("ballest/desktop/electron/ElectronShell") {
  static readonly layer = Layer.succeed(
    ElectronShell,
    ElectronShell.of({
      openExternal: (raw) =>
        Option.match(parseExternalUrl(raw), {
          onNone: () => Effect.succeed(false),
          onSome: (url) => Effect.promise(() => Electron.shell.openExternal(url).then(() => true, () => false))
        })
    })
  )
}
