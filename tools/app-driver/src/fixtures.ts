/** What a state opens first. The names are stable; what's behind them can move to generated maps without touching states. */
import * as fs from "node:fs"
import * as path from "node:path"
import { repoRoot } from "./session.ts"

const NAMED: Readonly<Record<string, string>> = {
  "map:simple": "sample:circuit s1 t1",
  "map:complex": "sample:Waterfront"
}

const sampleFiles = () =>
  ["UserSavedMaps", "Workshop"].flatMap((dir) =>
    fs.readdirSync(path.join(repoRoot, "samples", dir)).map((name) => path.join(repoRoot, "samples", dir, name))
  )

/** The map a fixture names, or null when it opens nothing: the app as it starts. Read here, never written back. */
export const readFixture = (fixture: string): { readonly name: string; readonly text: string } | null => {
  const resolved = NAMED[fixture] ?? fixture
  if (resolved === "none") return null
  const [kind, ...rest] = resolved.split(":")
  const value = rest.join(":")
  const file = kind === "file"
    ? value
    : kind === "sample"
    ? sampleFiles().find((candidate) => path.basename(candidate).includes(value))
    : undefined
  if (file === undefined || !fs.existsSync(file)) throw new Error(`no fixture ${fixture}`)
  return { name: path.basename(file), text: fs.readFileSync(file, "utf8") }
}
