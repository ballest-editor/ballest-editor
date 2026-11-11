import { Context, type Effect, Option } from "effect"

/** Only web links leave the app; anything else (file:, custom schemes) could launch arbitrary handlers. */
export const parseExternalUrl = (raw: string): Option.Option<string> => {
  const url = URL.parse(raw)
  return url !== null && (url.protocol === "https:" || url.protocol === "http:") ? Option.some(url.href) : Option.none()
}

export class ElectronShell extends Context.Service<ElectronShell, {
  /** Opens an http(s) URL in the default browser; false when refused or the OS failed to open it. */
  readonly openExternal: (url: string) => Effect.Effect<boolean>
  /** Asks Steam to start the game (`steam://rungameid/3339810`); false when no handler took the link. */
  readonly launchGame: Effect.Effect<boolean>
  /** Shows a folder in the file manager; false when it failed to open. */
  readonly openFolder: (path: string) => Effect.Effect<boolean>
}>()("ballest/desktop/electron/ElectronShell") {}
