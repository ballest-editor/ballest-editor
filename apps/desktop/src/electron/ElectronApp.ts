import { Context, type Effect, Schema, type Scope } from "effect"
import type * as Electron from "electron"

export interface ElectronAppMetadata {
  readonly appVersion: string
  readonly appPath: string
  readonly userData: string
  /** The user's documents folder, where the default project goes. */
  readonly documents: string
  readonly isPackaged: boolean
  readonly resourcesPath: string
}

export class ElectronAppReadyError extends Schema.TaggedError<ElectronAppReadyError>()("ElectronAppReadyError", {
  cause: Schema.Defect()
}) {
  override get message(): string {
    return "Electron failed to become ready."
  }
}

export class ElectronApp extends Context.Service<ElectronApp, {
  readonly metadata: Effect.Effect<ElectronAppMetadata>
  readonly whenReady: Effect.Effect<void, ElectronAppReadyError>
  readonly quit: Effect.Effect<void>
  /** Listens to an `app` event until the scope closes. */
  readonly on: (
    eventName: string,
    listener: (event: Electron.Event) => void
  ) => Effect.Effect<void, never, Scope.Scope>
}>()("ballest/desktop/electron/ElectronApp") {}
