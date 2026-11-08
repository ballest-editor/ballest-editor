/**
 * What snapping is set to (docs/SNAPPING.md): the base, what it affects, the steps, each target's toggle and parameters,
 * and the priority order. Settings holds the set a new map starts on, and a map that changes it keeps its own in its
 * sidecar. No renderer here.
 */
import { Effect, Schema } from "effect"
import type { Vec3 } from "./coords"
import { DEFAULT_GRID_SIZE, DEFAULT_ROTATION_STEP, DEFAULT_SCALE_STEP, formatGridSize } from "./snap"
import { ORIGIN } from "./ueMath"

export const SNAP_TARGETS = ["grid", "connectors", "mesh", "construction", "tracking", "alignment"] as const
export type SnapTarget = (typeof SNAP_TARGETS)[number]

export const SNAP_TARGET_NAMES: Readonly<Record<SnapTarget, string>> = {
  grid: "Grid",
  connectors: "Connectors",
  mesh: "Mesh",
  construction: "Construction",
  tracking: "Tracking",
  alignment: "Alignment"
}

export const SNAP_BASES = ["pivot", "closest", "centre"] as const

export const SNAP_PRESETS = {
  gridFirst: ["grid", "connectors", "mesh", "construction", "tracking", "alignment"],
  piecesFirst: ["connectors", "mesh", "construction", "tracking", "alignment", "grid"]
} as const satisfies Readonly<Record<string, ReadonlyArray<SnapTarget>>>
export type SnapPreset = keyof typeof SNAP_PRESETS

export const MESH_ELEMENTS = [
  "boundsCorners",
  "boundsFaceCentres",
  "boundsFaces",
  "vertices",
  "sharpEdges",
  "edgeMidpoints",
  "faceCentres",
  "faces"
] as const
export type MeshElement = (typeof MESH_ELEMENTS)[number]

export const MESH_ELEMENT_NAMES: Readonly<Record<MeshElement, string>> = {
  boundsCorners: "Bounds corners",
  boundsFaceCentres: "Bounds face centres",
  boundsFaces: "Bounds faces",
  vertices: "Vertices",
  sharpEdges: "Sharp edges",
  edgeMidpoints: "Edge midpoints",
  faceCentres: "Face centres",
  faces: "Faces"
}

const Positive = Schema.Finite.check(Schema.isGreaterThan(0))

/** The stops of the connectors' pull, weakest first: a quarter of their range to four times it. */
export const CONNECTOR_WEIGHTS = [0.25, 0.5, 1, 2, 4] as const

/** A pull as it reads: "×2", "×0.5". */
export const formatWeight = (weight: number): string => `×${weight}`
const Vector = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite })

const GridTarget = Schema.Struct({
  enabled: Schema.Boolean,
  /** Where the grid's lines count from, in the map's cm. */
  origin: Vector,
  /** The grid's turn about Z, in degrees: a tilted grid is a construction plane's job. */
  yaw: Schema.Finite
})

const ConnectorsTarget = Schema.Struct({
  enabled: Schema.Boolean,
  /** How far, in pixels, an end keeps hold; null: the general threshold. */
  range: Schema.NullOr(Positive),
  /** The piece turns so the ends face each other and their up directions agree. */
  matchRotation: Schema.Boolean,
  profiles: Schema.Literals(["strict", "warn", "any"]),
  showOpenEnds: Schema.Literals(["never", "hover", "always"]),
  /** Offers the mirrored twin when it would fit and the piece itself wouldn't. */
  flipToFit: Schema.Boolean,
  /**
   * How hard ends pull against Grid and Mesh (docs/SNAPPING.md § Priority): their range is multiplied by it, and above 1
   * they are asked ahead of both. Settings from before it read as 1.
   */
  weight: Schema.Finite.check(Schema.isBetween({ minimum: CONNECTOR_WEIGHTS[0], maximum: CONNECTOR_WEIGHTS[4] })).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1))
  )
})

const MeshTarget = Schema.Struct({
  enabled: Schema.Boolean,
  elements: Schema.Struct({
    boundsCorners: Schema.Boolean,
    boundsFaceCentres: Schema.Boolean,
    boundsFaces: Schema.Boolean,
    vertices: Schema.Boolean,
    sharpEdges: Schema.Boolean,
    edgeMidpoints: Schema.Boolean,
    faceCentres: Schema.Boolean,
    faces: Schema.Boolean
  }),
  /** An edge counts when its two faces meet at more than this, in degrees. */
  sharpAngle: Schema.Finite,
  occlusion: Schema.Literals(["front", "through"]),
  rotateToFace: Schema.Literals(["keep", "upright", "align"]),
  /** How far from a face the base lands, in cm along its normal. */
  offset: Schema.Finite
})

const ConstructionTarget = Schema.Struct({ enabled: Schema.Boolean })

const TrackingTarget = Schema.Struct({
  enabled: Schema.Boolean,
  /** How many acquired points are kept. */
  keep: Schema.Int.check(Schema.isGreaterThan(0)),
  /** How long a hover takes to acquire, in ms. */
  hoverMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  acquire: Schema.Literals(["auto", "shift"])
})

const AlignmentTarget = Schema.Struct({
  enabled: Schema.Boolean,
  gapGuides: Schema.Literals(["ortho", "always", "never"])
})

export const SnapConfig = Schema.Struct({
  /** Snap on or off: whether a move lands on a target. */
  enabled: Schema.Boolean,
  /** Grid step in cm: the game's list, or a typed one. */
  gridSize: Positive,
  /** Whether a turn snaps. */
  rotationEnabled: Schema.Boolean,
  /** Rotation step in degrees. */
  rotationStep: Positive,
  /** Whether a scale snaps. */
  scaleEnabled: Schema.Boolean,
  /** Scale step in percent. */
  scaleStep: Positive,
  base: Schema.Literals(SNAP_BASES),
  /** The pixels every target shares, unless it has a range of its own. */
  threshold: Positive,
  /** The targets, highest priority first. */
  order: Schema.Array(Schema.Literals(SNAP_TARGETS)),
  targets: Schema.Struct({
    grid: GridTarget,
    connectors: ConnectorsTarget,
    mesh: MeshTarget,
    construction: ConstructionTarget,
    tracking: TrackingTarget,
    alignment: AlignmentTarget
  })
})
export type SnapConfig = typeof SnapConfig.Type

export const defaultSnapConfig: SnapConfig = {
  enabled: false,
  gridSize: DEFAULT_GRID_SIZE,
  rotationEnabled: false,
  rotationStep: DEFAULT_ROTATION_STEP,
  scaleEnabled: false,
  scaleStep: DEFAULT_SCALE_STEP,
  base: "pivot",
  threshold: 12,
  order: SNAP_PRESETS.gridFirst,
  targets: {
    grid: { enabled: true, origin: ORIGIN, yaw: 0 },
    connectors: {
      enabled: true,
      range: null,
      matchRotation: true,
      profiles: "warn",
      showOpenEnds: "hover",
      flipToFit: true,
      weight: 1
    },
    mesh: {
      enabled: true,
      elements: {
        boundsCorners: true,
        boundsFaceCentres: true,
        boundsFaces: true,
        vertices: true,
        sharpEdges: true,
        edgeMidpoints: true,
        faceCentres: true,
        faces: true
      },
      sharpAngle: 30,
      occlusion: "front",
      rotateToFace: "keep",
      offset: 0
    },
    construction: { enabled: true },
    tracking: { enabled: true, keep: 6, hoverMs: 400, acquire: "auto" },
    alignment: { enabled: true, gapGuides: "ortho" }
  }
}

/** `order` as a whole list: each target once, those it lost at the end in the default order. */
const wholeOrder = (order: ReadonlyArray<SnapTarget>): ReadonlyArray<SnapTarget> => [
  ...new Set([...order, ...SNAP_TARGETS])
]

/** Every target in its place, on or off: the rows of the priority list. */
export const rowsOf = (config: SnapConfig): ReadonlyArray<SnapTarget> => wholeOrder(config.order)

/** The targets that are on, in the order they are asked. */
export const priorityOf = (config: SnapConfig): ReadonlyArray<SnapTarget> =>
  rowsOf(config).filter((target) => config.targets[target].enabled)

/**
 * The order a frame asks the targets in: the list's, except that Connectors pulling harder than even goes ahead of Grid
 * and Mesh wherever they stand above it. The other targets keep their places.
 */
export const askedOrder = (config: SnapConfig): ReadonlyArray<SnapTarget> => {
  const order = priorityOf(config)
  const at = order.indexOf("connectors")
  if (config.targets.connectors.weight <= 1 || at < 0) return order
  const first = order.findIndex((target) => target === "grid" || target === "mesh")
  if (first < 0 || first > at) return order
  const rest = order.filter((target) => target !== "connectors")
  return [...rest.slice(0, first), "connectors", ...rest.slice(first)]
}

/** Whether a move lands on the grid: snapping as a whole is on, and the Grid target is. */
export const snapsGrid = (config: SnapConfig): boolean => config.enabled && config.targets.grid.enabled

/** Whether a turn snaps to its step: under snapping as a whole, which Ctrl (`invert`) turns over, and its own toggle. */
export const snapsRotation = (config: SnapConfig, invert = false): boolean =>
  config.enabled !== invert && config.rotationEnabled

/** Whether a scale snaps to its step, as `snapsRotation` does a turn. */
export const snapsScale = (config: SnapConfig, invert = false): boolean =>
  config.enabled !== invert && config.scaleEnabled

export const withPreset = (config: SnapConfig, preset: SnapPreset): SnapConfig => ({
  ...config,
  order: SNAP_PRESETS[preset]
})

export const isPreset = (config: SnapConfig, preset: SnapPreset): boolean => {
  const order = SNAP_PRESETS[preset]
  return rowsOf(config).every((target, i) => target === order[i])
}

/** `config` with `target` at place `index` of the priority list. */
export const withTargetMoved = (config: SnapConfig, target: SnapTarget, index: number): SnapConfig => {
  const rest = rowsOf(config).filter((other) => other !== target)
  const at = Math.max(0, Math.min(index, rest.length))
  return { ...config, order: [...rest.slice(0, at), target, ...rest.slice(at)] }
}

/** How far, in pixels, `target` keeps hold of a drag, and how near a pick has to be. */
export const rangeOf = (config: SnapConfig, target: SnapTarget): number => {
  if (target !== "connectors") return config.threshold
  const { range, weight } = config.targets.connectors
  return (range ?? config.threshold) * weight
}

const isWorldOrigin = ({ x, y, z }: Vec3) => x === 0 && y === 0 && z === 0

const PROFILE_WORDS = { strict: "Strict", warn: "Warn", any: "Any" } as const
const OPEN_END_WORDS = { never: "hide open ends", hover: "show on hover", always: "show always" } as const
const FACE_WORDS = { keep: "keep rotation", upright: "upright", align: "align to face" } as const
const GAP_WORDS = { ortho: "gaps in ortho", always: "gaps always", never: "no gaps" } as const

/** A target's row in the priority list says this much about its parameters. */
export const targetSummary = (
  config: SnapConfig,
  target: SnapTarget,
  units: "cm" | "m",
  counts?: { readonly construction: number }
): string => {
  const { alignment, connectors, grid, mesh, tracking } = config.targets
  switch (target) {
    case "grid":
      return [
        formatGridSize(config.gridSize, units),
        isWorldOrigin(grid.origin) ? "world origin" : "own origin",
        ...(grid.yaw === 0 ? [] : [`${grid.yaw}°`])
      ].join(", ")
    case "connectors":
      return [
        PROFILE_WORDS[connectors.profiles],
        OPEN_END_WORDS[connectors.showOpenEnds],
        ...(connectors.weight === 1 ? [] : [`pull ${formatWeight(connectors.weight)}`])
      ].join(", ")
    case "mesh": {
      const on = MESH_ELEMENTS.filter((element) => mesh.elements[element]).length
      return `${on} of ${MESH_ELEMENTS.length} elements, ${FACE_WORDS[mesh.rotateToFace]}`
    }
    case "construction":
      return counts === undefined ? "Planes and axes" : `${counts.construction} planes and axes`
    case "tracking":
      return `Keeps ${tracking.keep}, ${tracking.acquire === "auto" ? "automatic" : "on Shift"}`
    case "alignment":
      return `In view, ${GAP_WORDS[alignment.gapGuides]}`
  }
}
