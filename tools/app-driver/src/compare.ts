/** `compare <before> <after>`: two runs, usually `main` in a second worktree and this branch. No baseline is committed. */
import * as fs from "node:fs"
import * as path from "node:path"
import { decodePng, differingPercent } from "./png.ts"
import { readResults, renderTiles, type ResultRow } from "./report.ts"
import { runsDir } from "./session.ts"

export interface StateChange {
  readonly key: string
  readonly status: "changed" | "added" | "removed"
  readonly pixelsPercent: number | null
  readonly a11yLines: number
  readonly metrics: ReadonlyArray<string>
}

export interface Comparison {
  readonly before: string
  readonly changed: ReadonlyArray<string>
  readonly changes: ReadonlyArray<StateChange>
  readonly table: string
}

/** A run by folder, or by name under this worktree's runs. */
export const resolveRun = (run: string): string => {
  const dir = fs.existsSync(path.join(run, "results.jsonl")) ? path.resolve(run) : path.join(runsDir, run)
  if (!fs.existsSync(path.join(dir, "results.jsonl"))) throw new Error(`no run at ${run}`)
  return dir
}

/** The newest run of this worktree. */
export const latestRun = (): string => {
  const names = fs.readdirSync(runsDir).filter((name) => fs.existsSync(path.join(runsDir, name, "results.jsonl")))
  const newest =
    names.sort((a, b) => fs.statSync(path.join(runsDir, b)).mtimeMs - fs.statSync(path.join(runsDir, a)).mtimeMs)[0]
  if (newest === undefined) throw new Error("no runs yet")
  return path.join(runsDir, newest)
}

/** How many lines are in one text and not the other, either way. */
export const lineDifference = (before: string, after: string): number => {
  const count = (text: string) => {
    const lines = new Map<string, number>()
    for (const line of text.split("\n")) lines.set(line, (lines.get(line) ?? 0) + 1)
    return lines
  }
  const a = count(before)
  const b = count(after)
  return [...new Set([...a.keys(), ...b.keys()])].reduce(
    (total, line) => total + Math.abs((a.get(line) ?? 0) - (b.get(line) ?? 0)),
    0
  )
}

/** Timings differ on every run; they are never a change. */
const NOISE = new Set(["settleMs"])

export const metricChanges = (before: ResultRow, after: ResultRow): ReadonlyArray<string> =>
  [...new Set([...Object.keys(before.metrics), ...Object.keys(after.metrics)])]
    .filter((name) => !NOISE.has(name) && before.metrics[name] !== after.metrics[name])
    .map((name) => `${name} ${before.metrics[name]} to ${after.metrics[name]}`)

const readText = (dir: string, file: string | undefined) =>
  file === undefined || !fs.existsSync(path.join(dir, file)) ? "" : fs.readFileSync(path.join(dir, file), "utf8")

const percentBetween = (beforeDir: string, before: string, afterDir: string, after: string) =>
  differingPercent(
    decodePng(fs.readFileSync(path.join(beforeDir, before))),
    decodePng(fs.readFileSync(path.join(afterDir, after)))
  )

/** The most any popped-out panel's window changed; one that came or went counts as all of it. */
export const windowsPercent = (beforeDir: string, before: ResultRow, afterDir: string, after: ResultRow): number =>
  before.windows.length !== after.windows.length ? 100 : Math.max(
    0,
    ...after.windows.map((window, index) => {
      const old = before.windows[index]
      return old === undefined ? 100 : percentBetween(beforeDir, old, afterDir, window)
    })
  )

const compareRow = (beforeDir: string, afterDir: string, before: ResultRow, after: ResultRow): StateChange | null => {
  const a11yLines = lineDifference(readText(beforeDir, before.a11y), readText(afterDir, after.a11y))
  const metrics = metricChanges(before, after)
  const pixelsPercent = before.hash === undefined || after.hash === undefined
    ? null
    : Math.max(
      before.hash === after.hash ? 0 : percentBetween(beforeDir, before.shot, afterDir, after.shot),
      windowsPercent(beforeDir, before, afterDir, after)
    )
  if (pixelsPercent === 0 && a11yLines === 0 && metrics.length === 0) return null
  return { key: after.key, status: "changed", pixelsPercent, a11yLines, metrics }
}

export const compareRuns = (beforeRun: string, afterRun: string): Comparison => {
  const beforeDir = resolveRun(beforeRun)
  const afterDir = resolveRun(afterRun)
  const before = new Map(readResults(beforeDir).map((row) => [row.key, row]))
  const after = new Map(readResults(afterDir).map((row) => [row.key, row]))
  const empty = { pixelsPercent: null, a11yLines: 0, metrics: [] }
  const changes: ReadonlyArray<StateChange> = [
    ...[...after.values()].flatMap((row) => {
      const old = before.get(row.key)
      if (old === undefined) return [{ key: row.key, status: "added" as const, ...empty }]
      return compareRow(beforeDir, afterDir, old, row) ?? []
    }),
    ...[...before.keys()].filter((key) => !after.has(key)).map((key) => ({
      key,
      status: "removed" as const,
      ...empty
    }))
  ]
  const table = changes.length === 0 ? "" : [
    "| state | status | pixels | a11y lines | metrics |",
    "| :-- | :-- | --: | --: | :-- |",
    ...changes.map(({ a11yLines, key, metrics, pixelsPercent, status }) =>
      `| ${key} | ${status} | ${pixelsPercent === null ? "n/a" : `${pixelsPercent}%`} | ${a11yLines} | ${
        metrics.join("; ")
      } |`
    )
  ].join("\n")
  return { before: path.basename(beforeDir), changed: changes.map(({ key }) => key), changes, table }
}

export interface CompareReport extends Comparison {
  readonly sheets: ReadonlyArray<string>
}

/** The comparison, with before and after side by side for each state that has both, in the after run's folder. */
export const compareWithSheets = async (beforeRun: string, afterRun: string): Promise<CompareReport> => {
  const comparison = compareRuns(beforeRun, afterRun)
  const beforeDir = resolveRun(beforeRun)
  const afterDir = resolveRun(afterRun)
  const before = new Map(readResults(beforeDir).map((row) => [row.key, row]))
  const after = new Map(readResults(afterDir).map((row) => [row.key, row]))
  const tiles = comparison.changes.flatMap(({ key }) => {
    const old = before.get(key)
    const current = after.get(key)
    return old === undefined || current === undefined
      ? []
      : [{
        label: key,
        images: [
          ...[old.shot, ...old.windows].map((shot) => path.join(beforeDir, shot)),
          ...[current.shot, ...current.windows].map((shot) => path.join(afterDir, shot))
        ]
      }]
  })
  const dir = path.join(afterDir, `compare-${comparison.before}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "compare.md"), `${comparison.table}\n`)
  const sheets = await renderTiles(dir, tiles, { columns: 2, width: 720, perSheet: 10 })
  return { ...comparison, sheets }
}
