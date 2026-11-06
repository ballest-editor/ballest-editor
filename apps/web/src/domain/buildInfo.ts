/** What Help › About says about this build, on the screen and on the clipboard alike. */

interface BuildFacts {
  /** The running app's version; a browser has no updater to say. */
  readonly version: string | null
  readonly commit: string
  /** ISO 8601. */
  readonly builtAt: string
  /** The desktop app's runtime; a browser has none. */
  readonly electron: string | null
  readonly chromium: string | null
}

/** A build's time as a bug report wants it: `2026-11-06 14:22 UTC`, whatever the reader's time zone. */
const formatBuiltAt = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`

/** One fact a line, the labels padded so the values line up in a mono block. Facts this build doesn't have are left out. */
export const buildInfoText = ({ version, commit, builtAt, electron, chromium }: BuildFacts): string => {
  const lines: ReadonlyArray<readonly [string, string | null]> = [
    ["Version", version],
    ["Commit", commit],
    ["Built", formatBuiltAt(builtAt)],
    ["Electron", electron],
    ["Chromium", chromium]
  ]
  const known = lines.flatMap(([label, value]) => value === null ? [] : [{ label, value }])
  const width = Math.max(...known.map(({ label }) => label.length))
  return known.map(({ label, value }) => `${label.padEnd(width)}  ${value}`).join("\n")
}
