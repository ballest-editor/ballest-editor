// The updater's state transitions, as plain functions of the state (see `UpdateState` in packages/contracts).
import type { ReleaseNoteBlock, UpdateState } from "@ballest/contracts"
import { Option, Predicate } from "effect"
import type { UpdateInfo } from "../electron/ElectronUpdater"
import { releaseNotesToBlocks } from "./releaseNotes"

/** This repository's GitHub Releases, the feed the packaged app checks. */
export const RELEASES_URL = "https://github.com/ballest-editor/ballest-editor/releases"

/** A newer release, as the page shows it. */
export interface Release {
  readonly version: string
  readonly notes: ReadonlyArray<ReleaseNoteBlock> | null
  /** ISO 8601, when the feed says. */
  readonly date: string | null
}

/** What decides whether this copy of the app can update itself. */
export interface UpdateEnvironment {
  readonly isPackaged: boolean
  readonly isDevelopment: boolean
  readonly platform: NodeJS.Platform
  /** The AppImage's own path, which its runtime exports as `APPIMAGE`; electron-updater replaces that file. */
  readonly appImage: Option.Option<string>
  /** `BALLEST_DISABLE_AUTO_UPDATE`. */
  readonly disabledByEnv: boolean
}

export const disabledReason = (env: UpdateEnvironment): Option.Option<string> => {
  if (env.isDevelopment || !env.isPackaged) return Option.some("Updates only run in an installed build.")
  if (env.disabledByEnv) return Option.some("Updates are turned off by BALLEST_DISABLE_AUTO_UPDATE.")
  if (env.platform === "linux" && Option.isNone(env.appImage)) {
    return Option.some("On Linux, only the AppImage updates itself.")
  }
  return Option.none()
}

export const initialState = (currentVersion: string, disabled: Option.Option<string>): UpdateState => ({
  status: Option.isSome(disabled) ? "disabled" : "idle",
  currentVersion,
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  releaseUrl: null,
  downloadPercent: null,
  message: Option.getOrNull(disabled)
})

/**
 * Checks run from `idle` or after a failed one. Once a release is on offer the app stays on it: the download is the
 * release that check found, and a newer one waits until the next start.
 */
export const canCheck = (state: UpdateState): boolean => state.status === "idle" || state.status === "error"

export const onCheckStart = (state: UpdateState): UpdateState => ({ ...state, status: "checking", message: null })

export const onCheckFailed = (state: UpdateState, message: string): UpdateState => ({
  ...state,
  status: "error",
  message
})

export const onUpToDate = (state: UpdateState): UpdateState => ({ ...state, status: "idle", message: null })

export const onAvailable = (state: UpdateState, release: Release): UpdateState => ({
  ...state,
  status: "available",
  availableVersion: release.version,
  releaseNotes: release.notes,
  releaseDate: release.date,
  releaseUrl: releaseUrlOf(release.version),
  downloadPercent: null,
  message: null
})

const downloadAt = (status: "downloading" | "ready", percent: number) => (state: UpdateState): UpdateState => ({
  ...state,
  status,
  downloadPercent: percent,
  message: null
})

export const onDownloadStart = downloadAt("downloading", 0)

export const onDownloadProgress = (state: UpdateState, percent: number): UpdateState => ({
  ...state,
  downloadPercent: Math.min(100, Math.max(0, percent))
})

export const onDownloaded = downloadAt("ready", 100)

/** Back to `available`, so the download can be retried. */
export const onDownloadFailed = (state: UpdateState, message: string): UpdateState => ({
  ...state,
  status: "available",
  downloadPercent: null,
  message
})

/** Still `ready`: the download is on disk, and restarting tries the installer again. */
export const onInstallFailed = (state: UpdateState, message: string): UpdateState => ({ ...state, message })

const noteOf = (raw: unknown, version: string): unknown => {
  if (!Array.isArray(raw)) return raw
  const entries: ReadonlyArray<unknown> = raw
  const entry = entries.find((e) => Predicate.hasProperty(e, "version") && e.version === version)
  return Predicate.hasProperty(entry, "note") ? entry.note : undefined
}

/**
 * The release notes as blocks for the page (see `releaseNotes.ts`): from a string (GitHub's HTML release body, or a
 * generic feed's plain text), or from a full changelog (one note per release) the newest `version`'s. Null when there
 * are none.
 */
export const releaseNotesOf = (raw: unknown, version: string): ReadonlyArray<ReleaseNoteBlock> | null => {
  const note = noteOf(raw, version)
  if (typeof note !== "string") return null
  const blocks = releaseNotesToBlocks(note)
  return blocks.length === 0 ? null : blocks
}

/** The release's page: the release workflow tags every version `v<version>`. */
export const releaseUrlOf = (version: string): string => `${RELEASES_URL}/tag/v${encodeURIComponent(version)}`

/** What the page shows of the release a check found. */
export const releaseOf = (info: UpdateInfo): Release => ({
  version: info.version,
  notes: releaseNotesOf(info.releaseNotes, info.version),
  date: Number.isNaN(Date.parse(info.releaseDate)) ? null : info.releaseDate
})
