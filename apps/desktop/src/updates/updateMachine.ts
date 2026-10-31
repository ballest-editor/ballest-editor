// The updater's state transitions, as plain functions of the state (see `UpdateState` in packages/contracts).
import type { UpdateState } from "@ballest/contracts"
import { Option, Predicate } from "effect"

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

export const onAvailable = (state: UpdateState, version: string, releaseNotes: string | null): UpdateState => ({
  ...state,
  status: "available",
  availableVersion: version,
  releaseNotes,
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

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }

const decodeEntity = (entity: string): string => {
  const code = entity.startsWith("#x")
    ? Number.parseInt(entity.slice(2), 16)
    : entity.startsWith("#")
    ? Number.parseInt(entity.slice(1), 10)
    : Number.NaN
  if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) return String.fromCodePoint(code)
  return ENTITIES[entity] ?? `&${entity};`
}

/** GitHub's release body arrives as HTML; the page shows it as text, so nothing in it can run or load. */
const htmlToText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(?:p|div|h[1-6]|ul|ol|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&([a-z]+|#\d+|#x[\da-f]+);/gi, (_, entity: string) => decodeEntity(entity))
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

const MAX_NOTES_LENGTH = 4000

const noteOf = (raw: unknown, version: string): unknown => {
  if (!Array.isArray(raw)) return raw
  const entries: ReadonlyArray<unknown> = raw
  const entry = entries.find((e) => Predicate.hasProperty(e, "version") && e.version === version)
  return Predicate.hasProperty(entry, "note") ? entry.note : undefined
}

/**
 * The release notes as plain text: a string as is, or from a full changelog (one note per release) the newest
 * `version`'s. Null when there are none.
 */
export const releaseNotesText = (raw: unknown, version: string): string | null => {
  const note = noteOf(raw, version)
  if (typeof note !== "string") return null
  const text = htmlToText(note)
  if (text === "") return null
  return text.length > MAX_NOTES_LENGTH ? `${text.slice(0, MAX_NOTES_LENGTH - 1).trimEnd()}…` : text
}
