import { Context, type Effect, Schema, type Scope } from "effect"
import type { StaticSite } from "../protocol/serveStatic"

/** The one host the app is served from: `ballest://app/`. */
export const HOST = "app"
export const SCHEMES = { production: "ballest", development: "ballest-dev" } as const

export const desktopScheme = (isDevelopment: boolean) => isDevelopment ? SCHEMES.development : SCHEMES.production
export const desktopUrl = (isDevelopment: boolean) => `${desktopScheme(isDevelopment)}://${HOST}/`

export type DesktopProtocolSource =
  | { readonly _tag: "Static"; readonly site: StaticSite }
  | { readonly _tag: "DevServer"; readonly origin: URL }

export class ElectronProtocolRegistrationError extends Schema.TaggedError<ElectronProtocolRegistrationError>()(
  "ElectronProtocolRegistrationError",
  { scheme: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Failed to handle the ${this.scheme}:// protocol.`
  }
}

export class ElectronProtocol extends Context.Service<ElectronProtocol, {
  /** Serves `ballest(-dev)://app/*` from `source` until the scope closes. */
  readonly register: (
    source: DesktopProtocolSource
  ) => Effect.Effect<void, ElectronProtocolRegistrationError, Scope.Scope>
}>()("ballest/desktop/electron/ElectronProtocol") {}
