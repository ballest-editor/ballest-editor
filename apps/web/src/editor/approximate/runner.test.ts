import { assert, describe, it } from "@effect/vitest"
import { DEFAULT_SETTINGS } from "../../domain/approximate/settings"
import type { WorkerReply, WorkerRequest } from "./protocol"
import { ApproximationRunner } from "./runner"

interface FakeWorker {
  /** The model keys of the requests it was sent. */
  readonly asked: Array<string>
  readonly reply: (reply: WorkerReply) => void
  readonly crash: (message: string) => void
  terminated: boolean
}

/** A runner whose workers are fakes, listed in the order it started them, and the replies its runs heard. */
const setup = () => {
  const workers: Array<FakeWorker> = []
  const heard: Array<string> = []
  const runner = new ApproximationRunner((reply, crash) => {
    const worker: FakeWorker = { asked: [], reply, crash, terminated: false }
    workers.push(worker)
    return {
      post: (request) => worker.asked.push(request.modelKey),
      terminate: () => {
        worker.terminated = true
      }
    }
  })
  const run = (modelKey: string) => {
    const request: WorkerRequest = { triangles: new Float32Array(9), modelKey, settings: DEFAULT_SETTINGS }
    runner.run(request, (reply) => heard.push(`${modelKey} ${reply.kind}`))
  }
  /** The `i`th worker the runner started. */
  const worker = (i: number) => {
    const started = workers[i]
    if (started === undefined) throw new Error(`no worker ${i}`)
    return started
  }
  return { runner, run, worker, workers, heard }
}

const progress: WorkerReply = { kind: "progress", placements: [], phase: "fitting" }
/** The fit threw: the run is over, the worker is fine. */
const failed: WorkerReply = { kind: "failed", message: "no" }

describe("ApproximationRunner", () => {
  it("replaces a worker that is busy, and no longer hears it", () => {
    const { heard, run, worker, workers } = setup()
    run("a")
    worker(0).reply(progress)
    run("b")
    assert.isTrue(worker(0).terminated)
    worker(0).reply(progress)
    worker(0).crash("late")
    worker(1).reply(progress)
    assert.deepStrictEqual(workers.map((each) => each.asked), [["a"], ["b"]])
    assert.deepStrictEqual(heard, ["a progress", "b progress"])
  })

  it("gives a worker whose run ended the next one, and stops only a run under way", () => {
    const { heard, run, runner, worker, workers } = setup()
    run("a")
    worker(0).reply(failed)
    // Nothing more is heard of a run that ended.
    worker(0).reply(progress)
    runner.stop()
    assert.isFalse(worker(0).terminated)
    run("b")
    assert.deepStrictEqual(workers.map((each) => each.asked), [["a", "b"]])
    runner.stop()
    assert.isTrue(worker(0).terminated)
    assert.deepStrictEqual(heard, ["a failed"])
  })

  it("reports a crash as a failed run and starts a new worker for the next", () => {
    const { heard, run, worker, workers } = setup()
    run("a")
    worker(0).crash("out of memory")
    assert.isTrue(worker(0).terminated)
    run("b")
    assert.lengthOf(workers, 2)
    assert.deepStrictEqual(heard, ["a failed"])
  })
})
