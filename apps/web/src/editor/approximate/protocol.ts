/** What the page and the approximation worker say to each other: one request a run, and the replies to it. */
import type { KeptOrder, Phase } from "../../domain/approximate/approximate"
import type { VoxelGrid } from "../../domain/approximate/grid/voxelize"
import type { Metrics } from "../../domain/approximate/look/evaluate"
import type { ApproximateSettings } from "../../domain/approximate/settings"
import type { Placement } from "../../domain/approximate/shapes"

export interface WorkerRequest {
  readonly triangles: Float32Array
  /** Names the model: the same key is the same triangles, so the worker keeps what it worked out about them. */
  readonly modelKey: string
  readonly settings: ApproximateSettings
  /** The order an earlier run of the same model and `orderKeyOf` kept, to cut instead of fitting again. */
  readonly cached?: KeptOrder
}

/** Any number of `progress` replies, then one `done` or `failed`, which ends the run. */
export type WorkerReply =
  | { readonly kind: "progress"; readonly placements: ReadonlyArray<Placement>; readonly phase: Phase }
  | {
    readonly kind: "done"
    readonly placements: ReadonlyArray<Placement>
    readonly metrics: Metrics
    /** The voxels the method saw. */
    readonly grid: VoxelGrid
    readonly order?: KeptOrder
    readonly milliseconds: number
  }
  | { readonly kind: "failed"; readonly message: string }
