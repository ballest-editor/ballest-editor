/**
 * The Web Worker that fits pieces to a model, off the page's thread: a request in, the pieces so far as they come,
 * then the result or why there is none. A fit can't be interrupted, so the page replaces the worker to stop one
 * (runner.ts). Between runs it keeps the model's reference, which is slow to make and the same for every setting
 * but Fill thin parts.
 */
import { approximate } from "../../domain/approximate/approximate"
import { type Reference, referenceOf } from "../../domain/approximate/look/evaluate"
import { meshReady } from "../../domain/approximate/mesh/mesh"
import type { WorkerReply, WorkerRequest } from "./protocol"

// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
const reply = (message: WorkerReply) => globalThis.postMessage(message)

/** The last reference made, and the model and Fill thin parts it was made for. */
let last: { readonly of: string; readonly reference: Reference } | undefined

const referenceFor = ({ modelKey, settings, triangles }: WorkerRequest): Reference => {
  const of = `${modelKey}|${settings.fillThin}`
  if (last?.of !== of) last = { of, reference: referenceOf(triangles, settings.fillThin) }
  return last.reference
}

const run = async (request: WorkerRequest): Promise<WorkerReply> => {
  const started = performance.now()
  await meshReady
  const { grid, metrics, order, placements } = approximate(
    request.triangles,
    request.settings,
    referenceFor(request),
    (soFar, phase) => reply({ kind: "progress", placements: soFar, phase }),
    request.cached
  )
  return {
    kind: "done",
    placements,
    metrics,
    grid,
    ...(order !== undefined && { order }),
    milliseconds: performance.now() - started
  }
}

globalThis.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void run(event.data).then(
    reply,
    (error: unknown) => reply({ kind: "failed", message: error instanceof Error ? error.message : String(error) })
  )
})
