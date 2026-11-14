// `pnpm approximate-bench`: the approximation methods on the sample models at equal piece counts, scored with the
// dialog's measures (tools/approximate/README.md § Bench). The parent runs one child process per model, method and
// count; a child writes its row and its pieces to the output folder, and the table is made from every row there.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { type Made, make } from "../../../apps/web/src/domain/approximate/approximate.ts"
import { evaluate, type Metrics, referenceOf } from "../../../apps/web/src/domain/approximate/look/evaluate.ts"
import { meshReady } from "../../../apps/web/src/domain/approximate/mesh/mesh.ts"
import {
  type ApproximateSettings,
  DEFAULT_SETTINGS,
  type Method,
  METHODS,
  type PieceSettings,
  SEARCH_SECONDS_MAX
} from "../../../apps/web/src/domain/approximate/settings.ts"
import { runChildren } from "./children.ts"
import { DEFAULT_MODEL_FOLDER, ensureModels, loadSample, SAMPLE_MODELS, sampleModels } from "./models.ts"

/** Every model's longest side, in cm. */
const MODEL_SIZE = 3000

const CACHE = path.join(os.homedir(), ".cache", "ballest-editor")

/** What a method made for one count, the setting that got it there, and how long making it took. */
interface Fit {
  readonly made: Made
  readonly setting: string
  readonly seconds: number
}

const timed = (settings: ApproximateSettings, triangles: Float32Array): Pick<Fit, "made" | "seconds"> => {
  const started = performance.now()
  const made = make(triangles, settings)
  return { made, seconds: (performance.now() - started) / 1000 }
}

/** The resolutions a search for a count looks between. */
const RESOLUTIONS = { low: 4, high: 220 }

/**
 * A method with no budget of its own, whose count grows with the resolution: run at the resolution whose count is
 * nearest `target` by ratio, of the ones a bisection tries. The time is the last run's, not the search's.
 */
const atNearestResolution = (method: Method) => (triangles: Float32Array, target: number): Fit => {
  const run = (resolution: number) => timed({ ...DEFAULT_SETTINGS, method, resolution, budget: Infinity }, triangles)
  const counts = new Map<number, number>()
  const countAt = (resolution: number) => {
    const known = counts.get(resolution) ?? run(resolution).made.placements.length
    counts.set(resolution, known)
    return known
  }
  let { high, low } = RESOLUTIONS
  while (high - low > 1) {
    const middle = Math.round(Math.sqrt(low * high))
    if (countAt(middle) < target) low = middle
    else high = middle
  }
  countAt(low)
  countAt(high)
  const off = (count: number) => Math.abs(Math.log(count / target))
  const [resolution] = [...counts].reduce((best, tried) => off(tried[1]) < off(best[1]) ? tried : best)
  return { ...run(resolution), setting: `res ${resolution}` }
}

/** A method that takes the count as its piece budget, run as the dialog runs it but for `pieces`. */
const atBudget =
  (method: Method, pieces: Partial<PieceSettings> = {}) =>
  (triangles: Float32Array, target: number, searchSeconds: number): Fit => {
    const settings: ApproximateSettings = {
      ...DEFAULT_SETTINGS,
      method,
      budget: target,
      searchSeconds,
      pieces: { ...DEFAULT_SETTINGS.pieces, ...pieces }
    }
    const fit = timed(settings, triangles)
    const faces = fit.made.plates === undefined ? "" : `, ${fit.made.plates.faces} faces`
    return { ...fit, setting: `res ${settings.resolution}${faces}, search ${searchSeconds}s` }
  }

/** The bench's methods by the name `--methods` takes, in the tables' order. */
const BENCHED: Readonly<
  Record<string, {
    readonly label: string
    /** `searchSeconds` is `--search-seconds`: the plates' mesh search cap, or the pieces' polish time. */
    readonly fit: (triangles: Float32Array, target: number, searchSeconds: number) => Fit
  }>
> = {
  voxels: { label: METHODS.voxels.label, fit: atNearestResolution("voxels") },
  boxes: { label: METHODS.boxes.label, fit: atNearestResolution("boxes") },
  pieces: { label: METHODS.piecesOnly.label, fit: atBudget("piecesOnly") },
  "pieces-3": {
    label: "Pieces only, cube/sphere/cylinder",
    fit: atBudget("piecesOnly", { kinds: ["box", "sphere", "cylinder"] })
  },
  "pieces-nospill": { label: "Pieces only, no spill", fit: atBudget("piecesOnly", { noSpill: true }) },
  plates: { label: METHODS.platesOnly.label, fit: atBudget("platesOnly") },
  mixed: { label: METHODS.mixed.label, fit: atBudget("mixed") }
}
const METHOD_NAMES = Object.keys(BENCHED)

/** One run: a model and a method by name, and the piece count to aim for. */
interface Job {
  readonly model: string
  readonly method: string
  readonly target: number
  readonly searchSeconds: number
}

/** A job's result as it is kept in `rows/`; a plates row also has what `Made.plates` records. */
interface Row extends Job {
  readonly pieces: number
  readonly setting: string
  readonly seconds: number
  readonly metrics: Metrics
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/** The job a child was handed on its command line. */
const jobOf = (text: string): Job => {
  const job: unknown = JSON.parse(text)
  if (
    isRecord(job) && typeof job["model"] === "string" && typeof job["method"] === "string" &&
    typeof job["target"] === "number" && typeof job["searchSeconds"] === "number"
  ) {
    return { model: job["model"], method: job["method"], target: job["target"], searchSeconds: job["searchSeconds"] }
  }
  throw new Error(`Not a job: ${text}`)
}

/** Whether a file in `rows/` is a row this script wrote, enough that an old or stray one can't break the table. */
const isRow = (value: unknown): value is Row =>
  isRecord(value) && typeof value["model"] === "string" && typeof value["method"] === "string" &&
  typeof value["pieces"] === "number" && isRecord(value["metrics"]) &&
  typeof value["metrics"]["silhouette"] === "number"

/** What names a job: its files, and its line as the bench goes. */
const keyOf = (job: Job) => `${job.model}-${job.method}-${job.target}`.replaceAll(/[^\w-]+/g, "_")

/** A child's whole work: one job, its row and its pieces written under `out`. */
const runJob = async (job: Job, folder: string, out: string): Promise<void> => {
  const model = sampleModels(folder).find((sample) => sample.name === job.model)
  const method = BENCHED[job.method]
  if (model === undefined || method === undefined) throw new Error(`No such job: ${JSON.stringify(job)}`)
  await meshReady
  const { triangles } = await loadSample(folder, model, MODEL_SIZE)
  const { made, seconds, setting } = method.fit(triangles, job.target, job.searchSeconds)
  const row: Row = {
    ...job,
    pieces: made.placements.length,
    setting,
    seconds,
    metrics: evaluate(referenceOf(triangles, DEFAULT_SETTINGS.fillThin), made.placements),
    ...made.plates
  }
  for (const [kind, content] of [["rows", row], ["pieces", made.placements]] as const) {
    fs.mkdirSync(path.join(out, kind), { recursive: true })
    fs.writeFileSync(path.join(out, kind, `${keyOf(job)}.json`), JSON.stringify(content))
  }
}

/** Every row under `out`. */
const readRows = (out: string): ReadonlyArray<Row> => {
  const folder = path.join(out, "rows")
  if (!fs.existsSync(folder)) return []
  return fs.readdirSync(folder).flatMap((file) => {
    const row: unknown = JSON.parse(fs.readFileSync(path.join(folder, file), "utf8"))
    return isRow(row) ? [row] : []
  })
}

const HEADINGS = [
  "| Method | Target | Pieces | Setting | IoU | Missed | Bulge | Outline | Face angle | Clutter | Time |",
  "| --- | --: | --: | --- | --: | --: | --: | --: | --: | --: | --: |"
]

const percent = (share: number) => `${(share * 100).toFixed(1)}%`
/** A length in cm, or a dash where there was nothing to measure. */
const cm = (length: number) => Number.isFinite(length) ? Math.round(length).toString() : "–"

const lineOf = ({ method, metrics, pieces, seconds, setting, target }: Row): string =>
  `| ${
    [
      BENCHED[method]?.label ?? method,
      target,
      pieces,
      setting,
      percent(metrics.iou),
      `${cm(metrics.missed.mean)} · ${cm(metrics.missed.p95)}`,
      `${cm(metrics.bulged.mean)} · ${cm(metrics.bulged.p95)}`,
      percent(metrics.silhouette),
      `${metrics.normalAngle.toFixed(1)}°`,
      // A row from before clutter was measured has none.
      Number.isFinite(metrics.clutter) ? metrics.clutter.toFixed(2) : "–",
      `${seconds.toFixed(1)} s`
    ].join(" | ")
  } |`

/** A table per model that has rows, the models in `names`' order and each one's rows by method, then by count. */
const tableOf = (rows: ReadonlyArray<Row>, names: ReadonlyArray<string>): string =>
  names.flatMap((name) => {
    const mine = rows.filter((row) => row.model === name).sort((a, b) =>
      METHOD_NAMES.indexOf(a.method) - METHOD_NAMES.indexOf(b.method) || a.target - b.target
    )
    return mine.length === 0 ? [] : [`### ${name}`, "", ...HEADINGS, ...mine.map(lineOf), ""]
  }).join("\n")

const HELP = `pnpm approximate-bench [options]

  --models <folder>   where the sample models are kept (default ${DEFAULT_MODEL_FOLDER}); missing ones are fetched
  --only <names>      models to run, comma-separated (default all: ${SAMPLE_MODELS.map((m) => m.name).join(", ")},
                      and every model in a folder inside the models folder)
  --methods <ids>     methods to run (default all: ${METHOD_NAMES.join(", ")})
  --counts <list>     piece counts to aim for (default 100,300,1000,3000)
  --out <folder>      where rows, pieces and table.md go (default ~/.cache/ballest-editor/approximate-bench)
  --jobs <n>          jobs at once (default half the cores)
  --search-seconds <0..${SEARCH_SECONDS_MAX}>  the plates' mesh search cap and the pieces' polish time, 0 for neither (default ${SEARCH_SECONDS_MAX})
  --force             rerun jobs that already have a row`

/** The ones of `all` that the comma-separated `names` list, or all of them without it. */
const chosen = (all: ReadonlyArray<string>, names: string | undefined): ReadonlyArray<string> =>
  names === undefined ? all : all.filter((name) => names.split(",").includes(name))

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      models: { type: "string", default: DEFAULT_MODEL_FOLDER },
      only: { type: "string" },
      methods: { type: "string" },
      counts: { type: "string", default: "100,300,1000,3000" },
      out: { type: "string", default: path.join(CACHE, "approximate-bench") },
      jobs: { type: "string", default: String(Math.floor(os.availableParallelism() / 2)) },
      "search-seconds": { type: "string", default: String(SEARCH_SECONDS_MAX) },
      force: { type: "boolean", default: false },
      // What the parent starts a child with.
      job: { type: "string" },
      help: { type: "boolean", default: false }
    }
  })
  if (values.help) {
    console.log(HELP)
    return
  }
  const out = path.resolve(values.out)
  if (values.job !== undefined) return runJob(jobOf(values.job), values.models, out)

  const searchSeconds = Number(values["search-seconds"])
  if (!(searchSeconds >= 0 && searchSeconds <= SEARCH_SECONDS_MAX)) {
    throw new Error(`--search-seconds must be between 0 and ${SEARCH_SECONDS_MAX}`)
  }
  const samples = sampleModels(values.models)
  const models = chosen(samples.map((sample) => sample.name), values.only)
  await ensureModels(values.models, samples.filter((sample) => models.includes(sample.name)))

  const waiting = models
    .flatMap((model) =>
      chosen(METHOD_NAMES, values.methods).flatMap((method) =>
        values.counts.split(",").map((count): Job => ({ model, method, target: Number(count), searchSeconds }))
      )
    )
    .filter((job) => values.force || !fs.existsSync(path.join(out, "rows", `${keyOf(job)}.json`)))
  await runChildren(
    fileURLToPath(import.meta.url),
    waiting,
    Number(values.jobs),
    keyOf,
    (job) => ["--job", JSON.stringify(job), "--models", values.models, "--out", out]
  )

  const table = tableOf(readRows(out), samples.map((sample) => sample.name))
  fs.writeFileSync(path.join(out, "table.md"), table)
  console.log(table)
}

await main()
