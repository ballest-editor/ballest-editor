// `pnpm approximate-golden`: the pieces each method makes for the sample models, with the clock frozen so the same
// code gives the same pieces every time (tools/approximate/README.md § Golden check). `--write` records them and
// `--check` compares against what was recorded: the proof that a change to the fitters' code changed no result.
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { make } from "../../../apps/web/src/domain/approximate/approximate.ts"
import { setClock } from "../../../apps/web/src/domain/approximate/clock.ts"
import { meshReady } from "../../../apps/web/src/domain/approximate/mesh/mesh.ts"
import { DEFAULT_SETTINGS, type Method } from "../../../apps/web/src/domain/approximate/settings.ts"
import type { Placement } from "../../../apps/web/src/domain/approximate/shapes.ts"
import { runChildren } from "./children.ts"
import { DEFAULT_MODEL_FOLDER, loadSample, sampleModels } from "./models.ts"

const MODEL_SIZE = 3000

/** What the recorded files call each method: the names the methods had when the first ones were recorded. */
const METHOD_OF = {
  greedy: "piecesOnly",
  platesOnly: "platesOnly",
  plates: "mixed",
  boxes: "boxes",
  voxels: "voxels"
} as const satisfies Readonly<Record<string, Method>>

interface Case {
  readonly model: string
  readonly method: keyof typeof METHOD_OF
  readonly budget: number
  /**
   * Seconds of mesh search or polish. At 0 the clock is frozen, so nothing depends on how often it is read. Above 0
   * it ticks a millisecond every time it is read, which bounds the search by its own work: the same pieces as long as
   * the searches read the clock at the same places.
   */
  readonly search: number
}

const keyOf = (c: Case) => `${c.model}-${c.method}-${c.budget}-s${c.search}`.replaceAll(/[^\w-]+/g, "_")

/** Every model without search, and the search itself on the models small enough to run it to its end. */
const CASES: ReadonlyArray<Case> = [
  ...["bunny", "teapot", "duck", "fox", "slotted disk", "pr2_head_pan", "smg-goomba", "smg-launch-star", "smg-star-bit"]
    .flatMap((model) =>
      (["greedy", "platesOnly", "plates"] as const).flatMap((method) =>
        [50, 150].map((budget): Case => ({ model, method, budget, search: 0 }))
      )
    ),
  ...["smg-reverse-gravity-tower", "smg-star-egg-road-ring", "smg-phantom-ship"].flatMap((model) =>
    (["greedy", "plates"] as const).map((method): Case => ({ model, method, budget: 100, search: 0 }))
  ),
  ...["bunny", "slotted disk"].flatMap((model) =>
    (["boxes", "voxels"] as const).map((method): Case => ({ model, method, budget: 300, search: 0 }))
  ),
  ...["duck", "smg-goomba", "smg-star-bit"].flatMap((model) =>
    (["greedy", "platesOnly", "plates"] as const).map((method): Case => ({ model, method, budget: 60, search: 2 }))
  )
]

/** What a case made, small enough to keep: how many pieces of each kind, and a digest of all of them. */
interface Golden {
  readonly pieces: number
  readonly kinds: Readonly<Record<string, number>>
  /** Of the placements exactly as made. */
  readonly exact: string
  /** Of the placements rounded to a hundredth of a cm and five decimals of turn: the same where only rounding moved. */
  readonly rounded: string
  readonly seconds: number
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)

/** Lengths to a hundredth of a cm; a turn's components, which are at most 1, to five decimals. */
const rounded = (_: string, v: unknown) => typeof v === "number" ? Math.round(v * (Math.abs(v) <= 1 ? 1e5 : 100)) : v

const goldenOf = (placements: ReadonlyArray<Placement>, seconds: number): Golden => {
  const kinds: Record<string, number> = {}
  for (const p of placements) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1
  return {
    pieces: placements.length,
    kinds,
    exact: digest(JSON.stringify(placements)),
    rounded: digest(JSON.stringify(placements, rounded)),
    seconds
  }
}

const runCase = async (c: Case, folder: string, out: string) => {
  const model = sampleModels(folder).find((m) => m.name === c.model)
  if (model === undefined) throw new Error(`No model ${c.model} in ${folder}`)
  await meshReady
  const { triangles } = await loadSample(folder, model, MODEL_SIZE)
  const started = performance.now()
  let ticks = 0
  setClock(() => c.search === 0 ? 0 : ticks++)
  // The dialog's defaults, but for what the case sets.
  const made = make(triangles, {
    ...DEFAULT_SETTINGS,
    method: METHOD_OF[c.method],
    budget: c.budget,
    searchSeconds: c.search
  })
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(
    path.join(out, `${keyOf(c)}.json`),
    JSON.stringify(goldenOf(made.placements, (performance.now() - started) / 1000))
  )
}

const isGolden = (value: unknown): value is Golden =>
  typeof value === "object" && value !== null && "exact" in value && typeof value.exact === "string" &&
  "rounded" in value && typeof value.rounded === "string" && "pieces" in value && typeof value.pieces === "number"

const read = (folder: string, c: Case): Golden | undefined => {
  const file = path.join(folder, `${keyOf(c)}.json`)
  if (!fs.existsSync(file)) return undefined
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
  return isGolden(value) ? value : undefined
}

const HELP = `pnpm approximate-golden --write | --check [options]

  --write             record what every case makes into the golden folder
  --check             make every case again and compare with the golden folder; exits 1 on a difference
  --golden <folder>   the golden folder (default ~/.cache/ballest-editor/approximate-golden)
  --models <folder>   where the sample models are kept (default ${DEFAULT_MODEL_FOLDER})
  --only <text>       only the cases whose key contains this
  --jobs <n>          cases at once (default 4)`

const main = async () => {
  const { values } = parseArgs({
    options: {
      write: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      golden: { type: "string", default: path.join(os.homedir(), ".cache", "ballest-editor", "approximate-golden") },
      models: { type: "string", default: DEFAULT_MODEL_FOLDER },
      only: { type: "string" },
      jobs: { type: "string", default: "4" },
      case: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", default: false }
    }
  })
  if (values.case !== undefined && values.out !== undefined) {
    const c = CASES.find((candidate) => keyOf(candidate) === values.case)
    if (c === undefined) throw new Error(`No case ${values.case}`)
    return runCase(c, values.models, values.out)
  }
  if (values.help || values.write === values.check) {
    console.log(HELP)
    return
  }
  const cases = CASES.filter((c) => values.only === undefined || keyOf(c).includes(values.only))
  const out = values.write ? values.golden : fs.mkdtempSync(path.join(os.tmpdir(), "approximate-golden-"))
  const failed = await runChildren(
    fileURLToPath(import.meta.url),
    cases,
    Number(values.jobs),
    keyOf,
    (c) => ["--case", keyOf(c), "--models", values.models, "--out", out]
  )
  if (values.write) {
    console.log(`Recorded ${cases.length - failed.length} of ${cases.length} cases in ${out}`)
    if (failed.length > 0) process.exitCode = 1
    return
  }
  let same = 0, drifted = 0
  const different: Array<string> = []
  for (const c of cases) {
    const was = read(values.golden, c), is = read(out, c)
    if (was === undefined) different.push(`${keyOf(c)}: nothing recorded`)
    else if (is === undefined) different.push(`${keyOf(c)}: failed`)
    else if (was.exact === is.exact) same++
    else if (was.rounded === is.rounded) drifted++
    else {different.push(
        `${keyOf(c)}: ${was.pieces} pieces ${JSON.stringify(was.kinds)} → ${is.pieces} ${JSON.stringify(is.kinds)}`
      )}
  }
  console.log(`${same} identical, ${drifted} the same to rounding, ${different.length} different`)
  for (const line of different) console.log(`  ${line}`)
  fs.rmSync(out, { recursive: true, force: true })
  if (different.length > 0) process.exitCode = 1
}

await main()
