import { Effect, Schema } from "effect"

/** A version electron-builder and electron-updater accept: semver without build metadata. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export class InvalidVersion extends Schema.TaggedError<InvalidVersion>()("InvalidVersion", {
  input: Schema.String
}) {
  override get message(): string {
    return `${JSON.stringify(this.input)} is not a release version (v1.2.3 or v1.2.3-rc.1)`
  }
}

export interface Release {
  readonly version: string
  /** Has a pre-release part (`-rc.1`): published as a GitHub prerelease, never marked latest. */
  readonly prerelease: boolean
}

/** `v0.2.0-rc.1` (a tag) or `0.2.0-rc.1` → the version the app is packaged as. */
export const parseRelease = (input: string): Effect.Effect<Release, InvalidVersion> => {
  const version = input.startsWith("v") ? input.slice(1) : input
  const match = SEMVER.exec(version)
  return match === null
    ? Effect.fail(new InvalidVersion({ input }))
    : Effect.succeed({ version, prerelease: match[4] !== undefined })
}
