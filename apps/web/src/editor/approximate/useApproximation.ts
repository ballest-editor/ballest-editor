/**
 * The approximation dialog's two pieces of state: the model read from the chosen file, and the run that fits pieces to
 * it in a worker whenever the model or the settings change.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { keptCovers, type KeptOrder, keptPrefix, keptTotal, type Phase } from "../../domain/approximate/approximate"
import type { VoxelGrid } from "../../domain/approximate/grid/voxelize"
import type { Metrics } from "../../domain/approximate/look/evaluate"
import { type ApproximateSettings, orderKeyOf } from "../../domain/approximate/settings"
import type { Placement } from "../../domain/approximate/shapes"
import { defaultUpAxis, type LoadedModel, placeModel, readModel, type UpAxis } from "./loadModel"
import { ApproximationRunner } from "./runner"

/** How long the settings must rest before a run starts, so dragging a slider doesn't start one per step. */
const SETTLE_MS = 250

export interface ModelFile {
  readonly file: File | null
  readonly up: UpAxis
  /** The longest side, in cm. */
  readonly size: number
  /** The file's triangles scaled and placed; null until it is read, or when it can't be. */
  readonly model: LoadedModel | null
  /** Names the model as placed: the same key is the same triangles. */
  readonly modelKey: string
  readonly error: string | null
  readonly choose: (file: File | undefined) => void
  readonly setUp: (up: UpAxis) => void
  readonly setSize: (size: number) => void
}

/** A file's triangles, with what they were read from and which way was taken as up. */
interface ReadFile {
  readonly file: File
  readonly up: UpAxis
  readonly triangles: Float32Array
}

/**
 * What was read, if it is of `file` with `up` as up. A new file or up axis is read again, which takes a while: until
 * it is, there are no triangles, not the last ones under the new name or the other way up.
 */
export const trianglesFor = (read: ReadFile | null, file: File | null, up: UpAxis): Float32Array | null =>
  read?.file === file && read.up === up ? read.triangles : null

/** The chosen file, read as triangles in the game's frame with `up` as its up axis, its longest side `size` cm. */
export const useModelFile = (): ModelFile => {
  const [file, setFile] = useState<File | null>(null)
  const [up, setUp] = useState<UpAxis>("y")
  const [size, setSize] = useState(3000)
  const [read, setRead] = useState<ReadFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (file === null) return
    let current = true
    readModel(file, up).then(
      (triangles) => {
        if (!current) return
        setError(triangles.length === 0 ? "The file has no triangles." : null)
        setRead(triangles.length === 0 ? null : { file, up, triangles })
      },
      (failure: unknown) => {
        if (!current) return
        setRead(null)
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    )
    return () => {
      current = false
    }
  }, [file, up])

  const raw = trianglesFor(read, file, up)
  const model = useMemo(
    () => raw === null || file === null ? null : placeModel(file.name, raw, size),
    [file, raw, size]
  )
  return {
    file,
    up,
    size,
    model,
    // The file's size and date tell two files of one name apart, so neither is shown the other's kept results.
    modelKey: model === null || file === null
      ? ""
      : `${file.name}|${file.size}|${file.lastModified}|${up}|${size}`,
    error,
    choose: (next) => {
      if (next === undefined) return
      setFile(next)
      setRead(null)
      setError(null)
      setUp(defaultUpAxis(next.name))
    },
    setUp,
    setSize
  }
}

export type Run =
  | { readonly status: "idle" }
  | {
    readonly status: "running"
    readonly placements: ReadonlyArray<Placement>
    readonly phase: Phase
    /** `performance.now()` when the run started; null while it waits for the settings to rest. */
    readonly startedAt: number | null
  }
  | {
    readonly status: "done"
    readonly placements: ReadonlyArray<Placement>
    readonly metrics: Metrics
    readonly grid: VoxelGrid
    readonly milliseconds: number
  }
  | { readonly status: "failed"; readonly message: string }

export interface Approximation {
  readonly run: Run
  /** The pieces to show: the run's so far, or its result. */
  readonly placements: ReadonlyArray<Placement>
  /** How many pieces the method made before the budget cut them, where it ranks them (Merged boxes). */
  readonly total: number | undefined
}

const NO_PLACEMENTS: ReadonlyArray<Placement> = []
const IDLE: Run = { status: "idle" }

/** A run, with the model and the model and settings it is of. */
export interface HeldRun {
  readonly run: Run
  readonly modelKey: string
  readonly runKey: string
}

const NOTHING_HELD: HeldRun = { run: IDLE, modelKey: "", runKey: "" }

const placementsOf = (run: Run): ReadonlyArray<Placement> =>
  run.status === "running" || run.status === "done" ? run.placements : NO_PLACEMENTS

/**
 * What to show of `held` for the model and settings now asked for. A run of them is shown as it is. One of the same
 * model with other settings is out of date: its pieces stay in view while the new fit waits to start, but as a run
 * under way, never as a result to open. One of another model shows nothing.
 */
export const shownRun = (held: HeldRun, modelKey: string, runKey: string): Run =>
  held.modelKey !== modelKey || modelKey === ""
    ? IDLE
    : held.runKey === runKey
    ? held.run
    : { status: "running", placements: placementsOf(held.run), phase: "fitting", startedAt: null }

/**
 * Fits pieces to `model` with `settings` while `active`, again whenever either changes. A budget the last order
 * covers is cut from it rather than fitted again (`KeptOrder`), and shows its first pieces at once.
 */
export const useApproximation = (
  model: LoadedModel | null,
  modelKey: string,
  settings: ApproximateSettings,
  active: boolean
): Approximation => {
  const [held, setHeld] = useState<HeldRun>(NOTHING_HELD)
  const runner = useRef<ApproximationRunner | null>(null)
  /** The last order, by model and `orderKeyOf`. */
  const kept = useRef<{ readonly key: string; readonly order: KeptOrder } | null>(null)
  const [total, setTotal] = useState<{ readonly key: string; readonly count: number } | null>(null)
  /** What the finished run was of, so opening the dialog again doesn't fit the same thing twice. */
  const finished = useRef<string | null>(null)
  const key = `${modelKey}|${orderKeyOf(settings)}`
  const runKey = `${modelKey}|${JSON.stringify(settings)}`

  useEffect(() => {
    if (!active || model === null || finished.current === runKey) return
    const timer = setTimeout(() => {
      runner.current ??= new ApproximationRunner()
      const cached = kept.current?.key === key && keptCovers(kept.current.order, settings.budget)
        ? kept.current.order
        : undefined
      const startedAt = performance.now()
      finished.current = null
      const setRun = (run: Run) => setHeld({ run, modelKey, runKey })
      // A budget the kept order covers shows its first pieces at once; otherwise the last pieces of this model stay.
      setHeld((before) => ({
        modelKey,
        runKey,
        run: cached !== undefined
          ? { status: "running", placements: keptPrefix(cached, settings.budget), phase: "refining", startedAt }
          : {
            status: "running",
            placements: before.modelKey === modelKey ? placementsOf(before.run) : NO_PLACEMENTS,
            phase: "fitting",
            startedAt
          }
      }))
      runner.current.run(
        { triangles: model.triangles, modelKey, settings, ...(cached !== undefined && { cached }) },
        (reply) => {
          if (reply.kind === "progress") {
            setRun({ status: "running", placements: reply.placements, phase: reply.phase, startedAt })
          } else if (reply.kind === "failed") setRun({ status: "failed", message: reply.message })
          else {
            if (reply.order !== undefined) {
              kept.current = { key, order: reply.order }
              setTotal({ key, count: keptTotal(reply.order) })
            }
            finished.current = runKey
            setRun({ status: "done", ...reply })
          }
        }
      )
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [active, key, model, modelKey, runKey, settings])

  useEffect(() => {
    if (!active) runner.current?.stop()
  }, [active])
  useEffect(() => () => runner.current?.dispose(), [])

  const shown = shownRun(held, modelKey, runKey)
  return {
    run: shown,
    placements: placementsOf(shown),
    total: total?.key === key ? total.count : undefined
  }
}
