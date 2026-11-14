/**
 * Runs one approximation at a time in a worker. An idle worker takes the next run, with what it kept from the last;
 * a busy one can't be interrupted, so a run started meanwhile, or `stop`, ends it and the next run starts a new one.
 */
import type { WorkerReply, WorkerRequest } from "./protocol"

/** A started worker, as the runner uses one. */
interface FitWorker {
  readonly post: (request: WorkerRequest) => void
  readonly terminate: () => void
}

/** Starts a worker that hands every reply to `onReply`, and to `onCrash` why it died if it does. */
type StartWorker = (onReply: (reply: WorkerReply) => void, onCrash: (message: string) => void) => FitWorker

const startFitWorker: StartWorker = (onReply, onCrash) => {
  const worker = new Worker(new URL("./approximate.worker.ts", import.meta.url), { type: "module" })
  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => onReply(event.data))
  worker.addEventListener("error", (event) => onCrash(event.message || "The approximation stopped."))
  return {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin
    post: (request) => worker.postMessage(request),
    terminate: () => worker.terminate()
  }
}

export class ApproximationRunner {
  private worker: FitWorker | undefined
  /** Where the run under way sends its replies; undefined between runs. */
  private onReply: ((reply: WorkerReply) => void) | undefined
  private readonly start: StartWorker

  constructor(start: StartWorker = startFitWorker) {
    this.start = start
  }

  /** Starts a run, in place of the one under way if there is one. `onReply` hears nothing after the run ends. */
  run(request: WorkerRequest, onReply: (reply: WorkerReply) => void): void {
    this.stop()
    this.onReply = onReply
    this.worker ??= this.started()
    this.worker.post(request)
  }

  /** Ends the run under way. An idle worker stays for the next run. */
  stop(): void {
    if (this.onReply !== undefined) this.dispose()
  }

  /** Ends the worker, running or not. */
  dispose(): void {
    this.worker?.terminate()
    this.worker = undefined
    this.onReply = undefined
  }

  private started(): FitWorker {
    // A worker that was replaced may still have replies on their way: only the current one is heard.
    const worker = this.start(
      (reply) => {
        if (this.worker !== worker) return
        const onReply = this.onReply
        if (reply.kind !== "progress") this.onReply = undefined
        onReply?.(reply)
      },
      (message) => {
        if (this.worker !== worker) return
        const onReply = this.onReply
        this.dispose()
        onReply?.({ kind: "failed", message })
      }
    )
    return worker
  }
}
