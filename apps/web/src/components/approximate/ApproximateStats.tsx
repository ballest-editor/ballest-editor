/** What the approximation dialog says of a run over its preview: the pieces so far, then how well they match. */
import { useEffect, useState } from "react"
import type { Metrics, SurfaceGap } from "../../domain/approximate/look/evaluate"
import { shapeKinds, SHAPES } from "../../domain/approximate/shapes"
import { SHAPE_COLORS } from "../../editor/approximate/ApproximatePreview"
import type { Run } from "../../editor/approximate/useApproximation"

const percent = (share: number) => `${(share * 100).toFixed(1)}%`

const gap = ({ mean, p95 }: SurfaceGap) => Number.isFinite(mean) ? `${Math.round(mean)} · ${Math.round(p95)} cm` : "–"

/** Each measure's label, what hovering it says, and its value; the strong ones are what to judge a result by. */
const measuresOf = (metrics: Metrics): ReadonlyArray<readonly [string, string, string, boolean]> => [
  [
    "Outline",
    "How much the outlines match from twelve fixed views, averaged: 100% is the same outline",
    percent(metrics.silhouette),
    true
  ],
  [
    "Face angle",
    "The mean angle between the model's faces and the pieces' faces where both show in those views: lower shades more like the model",
    `${metrics.normalAngle.toFixed(1)}°`,
    true
  ],
  [
    "Clutter",
    "The pieces' edges over the model's own in those views, where depth or face direction jumps: 1 is as busy as the model, higher looks rougher",
    metrics.clutter.toFixed(2),
    true
  ],
  [
    "Match (IoU)",
    "Shared voxels over the voxels either holds, at a fixed reference resolution",
    percent(metrics.iou),
    false
  ],
  ["Covered", "The share of the model's voxels the pieces cover", percent(metrics.coverage), false],
  ["Spill", "The share of the pieces' voxels outside the model", percent(metrics.spill), false],
  [
    "Missed",
    "From the model's surface to the pieces' surface, mean · 95th percentile: where the pieces miss detail",
    gap(metrics.missed),
    false
  ],
  [
    "Bulge",
    "From the pieces' surface to the model's surface, mean · 95th percentile: where the pieces bulge",
    gap(metrics.bulged),
    false
  ]
]

/** Whole seconds since `startedAt` (a `performance.now()`), counted up while mounted; 0 while there is none. */
const useElapsedSeconds = (startedAt: number | null): number => {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (startedAt === null) return
    const tick = () => setSeconds(Math.floor((performance.now() - startedAt) / 1000))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return seconds
}

function Running({ pieces, run }: { readonly pieces: number; readonly run: Extract<Run, { status: "running" }> }) {
  const seconds = useElapsedSeconds(run.startedAt)
  const elapsed = run.startedAt === null ? "" : ` · ${seconds} s`
  return <>{run.phase === "fitting" ? "Fitting" : "Refining"}… {pieces} pieces{elapsed}</>
}

export function ApproximateStats({ run }: { readonly run: Run }) {
  if (run.status === "idle") return null
  if (run.status === "failed") {
    return <div className="rounded-control bg-popover/90 p-2 text-caption text-destructive">{run.message}</div>
  }
  const placements = run.placements
  const counts = shapeKinds.map((kind) => [kind, placements.filter((p) => p.kind === kind).length] as const)
  return (
    <div className="flex flex-col gap-1 rounded-control bg-popover/90 p-2 text-caption shadow-sm ring-1 ring-edge">
      <div className="text-body-strong tabular-nums" aria-live="polite">
        {run.status === "running"
          ? <Running pieces={placements.length} run={run} />
          : `${placements.length} pieces · ${(run.milliseconds / 1000).toFixed(1)} s`}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {counts.filter(([, n]) => n > 0).map(([kind, n]) => (
          <span key={kind} className="flex items-center gap-1 tabular-nums">
            <span aria-hidden className="size-2 rounded-full" style={{ background: SHAPE_COLORS[kind] }} />
            {SHAPES[kind].label} {n}
          </span>
        ))}
      </div>
      {run.status === "done" && (
        <div className="grid grid-cols-[auto_auto] gap-x-3 tabular-nums text-fg-secondary">
          {measuresOf(run.metrics).flatMap(([label, title, value, strong]) => [
            <span key={label} title={title}>{label}</span>,
            <span key={`${label}-value`} {...(strong && { className: "text-foreground" })}>{value}</span>
          ])}
        </div>
      )}
    </div>
  )
}
