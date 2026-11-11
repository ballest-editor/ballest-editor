/**
 * What a map's snapping is set to (docs/SNAPPING.md): the base, what it affects, the steps, each target's toggle and
 * parameters, and the priority order. Settings holds the set a new map starts on, and a map that changes it keeps its
 * own in its sidecar. How snapping behaves for the user, whatever the map, is `SnapPrefs`. No renderer here.
 */
import { Effect, Predicate, Schema, SchemaGetter } from "effect"
import type { Vec3 } from "./coords"
import { DEFAULT_GRID_SIZE, DEFAULT_ROTATION_STEP, DEFAULT_SCALE_STEP, formatGridSize } from "./snap"
import { ORIGIN } from "./ueMath"

export const SNAP_TARGETS = ["grid", "connectors", "mesh", "construction", "tracking", "alignment"] as const
export type SnapTarget = (typeof SNAP_TARGETS)[number]

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
  boundsFaceCentres: "Bounds face centers",
  boundsFaces: "Bounds faces",
  vertices: "Vertices",
  sharpEdges: "Sharp edges",
  edgeMidpoints: "Edge midpoints",
  faceCentres: "Face centers",
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
  rotateToFace: Schema.Literals(["keep", "upright", "align"]),
  /** How far from a face the base lands, in cm along its normal. */
  offset: Schema.Finite
})

const ConstructionTarget = Schema.Struct({ enabled: Schema.Boolean })

const TrackingTarget = Schema.Struct({ enabled: Schema.Boolean })

const AlignmentTarget = Schema.Struct({
  enabled: Schema.Boolean,
  gapGuides: Schema.Literals(["ortho", "always", "never"])
})

/** The parts of a gated snap config that change on the way to the current form. */
interface Gated {
  readonly enabled: boolean
  readonly targets: { readonly grid: object }
}

/** `gated` as it behaved, in the current form: see `ungatedSnapping`. */
const ungated = <T extends Gated>({ enabled, ...rest }: T) =>
  enabled ? { ...rest, magnet: true } : {
    ...rest,
    magnet: false,
    rotationEnabled: false,
    scaleEnabled: false,
    targets: { ...rest.targets, grid: { ...rest.targets.grid, enabled: false } }
  }

/**
 * A snap config saved while the magnet was snapping as a whole, read as it behaved (docs/SNAPPING.md § Affect). Its
 * `enabled` becomes `magnet`. Saved off, nothing snapped, so the grid, Rotate and Scale come off with it and it still
 * snaps nothing; saved on, they stay as they were. Anything else passes as it is. An old Settings save can hold only a
 * part of one, which Settings fills in field by field.
 */
export const ungatedSnapping = (stored: unknown): unknown => {
  if (!Predicate.isObject(stored) || typeof stored["enabled"] !== "boolean" || "magnet" in stored) return stored
  const targets = Predicate.isObject(stored["targets"]) ? stored["targets"] : {}
  const grid = Predicate.isObject(targets["grid"]) ? targets["grid"] : {}
  return ungated({ ...stored, enabled: stored["enabled"], targets: { ...targets, grid } })
}

/** Everything but the switch the magnet is, which changed meaning (`ungatedSnapping`). */
const snapConfigFields = {
  /** Grid step in cm: the game's list, or a typed one. */
  gridSize: Positive,
  /** Whether a turn snaps to its step, magnet or not. */
  rotationEnabled: Schema.Boolean,
  /** Rotation step in degrees. */
  rotationStep: Positive,
  /** Whether a scale snaps to its step, magnet or not. */
  scaleEnabled: Schema.Boolean,
  /** Resize dimensions to grid multiples when bounds are known, while the grid is on. */
  scaleToGrid: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(true))),
  /** Scale step in percent. */
  scaleStep: Positive,
  base: Schema.Literals(SNAP_BASES),
  /** The pixels every target shares, unless it has a range of its own. */
  threshold: Positive,
  /** The targets, highest priority first. */
  order: Schema.Array(Schema.Literals(SNAP_TARGETS)),
  targets: Schema.Struct({
    /** The grid's switch is its own: a move lands on the grid while it is on, magnet or not. */
    grid: GridTarget,
    connectors: ConnectorsTarget,
    mesh: MeshTarget,
    construction: ConstructionTarget,
    tracking: TrackingTarget,
    alignment: AlignmentTarget
  })
}

const SnapConfigNow = Schema.Struct({
  /**
   * The magnet: snapping to what is in the map, every target but the grid (`targetOn`). The grid, a turn's step and
   * a scale's step have switches of their own and don't wait on it.
   */
  magnet: Schema.Boolean,
  ...snapConfigFields
})

/** A snap config saved while its `enabled` was snapping as a whole, grid and steps included (`ungatedSnapping`). */
const SnapConfigGated = Schema.Struct({ enabled: Schema.Boolean, ...snapConfigFields }).pipe(
  Schema.decodeTo(SnapConfigNow, {
    decode: SchemaGetter.transform(ungated),
    encode: SchemaGetter.forbidden(() => "A snap config is saved in its current form")
  })
)

/** A map's snapping; one saved in the gated form reads as it behaved (`ungatedSnapping`), and is saved in this one. */
export const SnapConfig = Schema.Union([SnapConfigNow, SnapConfigGated])
export type SnapConfig = typeof SnapConfig.Type

/** Nothing snaps until it is turned on: the magnet, the grid, Rotate and Scale all start off. */
export const defaultSnapConfig: SnapConfig = {
  magnet: false,
  gridSize: DEFAULT_GRID_SIZE,
  rotationEnabled: false,
  rotationStep: DEFAULT_ROTATION_STEP,
  scaleEnabled: false,
  scaleToGrid: true,
  scaleStep: DEFAULT_SCALE_STEP,
  base: "pivot",
  threshold: 12,
  order: SNAP_PRESETS.gridFirst,
  targets: {
    grid: { enabled: false, origin: ORIGIN, yaw: 0 },
    connectors: {
      enabled: true,
      range: null,
      matchRotation: true,
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
      rotateToFace: "keep",
      offset: 0
    },
    construction: { enabled: true },
    tracking: { enabled: true },
    alignment: { enabled: true, gapGuides: "ortho" }
  }
}

/** `order` as a whole list: each target once, those it lost at the end in the default order. */
const wholeOrder = (order: ReadonlyArray<SnapTarget>): ReadonlyArray<SnapTarget> => [
  ...new Set([...order, ...SNAP_TARGETS])
]

/** Every target in its place, on or off: the rows of the priority list. */
export const rowsOf = (config: SnapConfig): ReadonlyArray<SnapTarget> => wholeOrder(config.order)

/**
 * Whether `target` snaps under `config`: the grid by its own switch, every other target by its own and the magnet's
 * (docs/SNAPPING.md § Affect).
 */
export const targetOn = (config: SnapConfig, target: SnapTarget): boolean =>
  config.targets[target].enabled && (target === "grid" || config.magnet)

/** The targets that are on, in the order they are asked. */
export const priorityOf = (config: SnapConfig): ReadonlyArray<SnapTarget> =>
  rowsOf(config).filter((target) => targetOn(config, target))

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

/** Whether a move lands on the grid: the Grid target's own switch, magnet or not. */
export const snapsGrid = (config: SnapConfig): boolean => targetOn(config, "grid")

/**
 * How a scrub of a position field lands on the grid along `axis` (docs/SNAPPING.md § Numeric steps): in the grid's
 * steps, counted from its origin as measured from `shownFrom`, where the field reads 0; undefined while the grid is
 * off. A turned grid's X and Y lines don't run along the fields' axes, so there those scrubs only keep its spacing from
 * its origin.
 */
export const gridScrubOf = (
  config: SnapConfig,
  axis: "x" | "y" | "z",
  shownFrom: Vec3 = ORIGIN
): { readonly step: number; readonly from: number } | undefined =>
  snapsGrid(config) ? { step: config.gridSize, from: config.targets.grid.origin[axis] - shownFrom[axis] } : undefined

/** Whether a turn snaps to its step: Rotate's own switch, magnet or not, unless Ctrl turns it `off`. */
export const snapsRotation = (config: SnapConfig, off = false): boolean => !off && config.rotationEnabled

/** Whether a scale snaps to its step, as `snapsRotation` does a turn. */
export const snapsScale = (config: SnapConfig, off = false): boolean => !off && config.scaleEnabled

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

/**
 * What a held key narrows snapping to, for as long as it is held (docs/SNAPPING.md § Modifiers): connectors, the mesh,
 * or alignment with tracking. The grid has no key: each of these keeps it off.
 */
export const SNAP_KINDS = ["connectors", "mesh", "alignment"] as const
export type SnapKind = (typeof SNAP_KINDS)[number]

/** What each transform can be narrowed to: a scale stops on nothing but the mesh. */
export const SNAP_KINDS_OF = {
  move: ["connectors", "mesh", "alignment"],
  turn: ["connectors", "mesh", "alignment"],
  scale: ["mesh"]
} as const satisfies Readonly<Record<string, ReadonlyArray<SnapKind>>>
export type SnapTransform = keyof typeof SNAP_KINDS_OF

/** The targets each kind keeps on. */
const KIND_TARGETS: Readonly<Record<SnapKind, ReadonlyArray<SnapTarget>>> = {
  connectors: ["connectors"],
  mesh: ["mesh"],
  alignment: ["alignment", "tracking"]
}

/** Of `kinds`, those that mean something to `transform`. */
export const kindsFor = (transform: SnapTransform, kinds: ReadonlyArray<SnapKind>): ReadonlyArray<SnapKind> =>
  kinds.filter((kind) => (SNAP_KINDS_OF[transform] as ReadonlyArray<SnapKind>).includes(kind))

/**
 * `config` while the keys of `kinds` are held: those kinds' targets on and every other off, the grid among them, with
 * their parameters and their place in the priority list as they were. Holding one turns the magnet on for its kind.
 * With no kinds it is `config` itself.
 */
export const narrowedTo = (config: SnapConfig, kinds: ReadonlyArray<SnapKind>): SnapConfig => {
  if (kinds.length === 0) return config
  const kept = new Set(kinds.flatMap((kind) => KIND_TARGETS[kind]))
  const { alignment, connectors, construction, grid, mesh, tracking } = config.targets
  return {
    ...config,
    magnet: true,
    targets: {
      grid: { ...grid, enabled: false },
      connectors: { ...connectors, enabled: kept.has("connectors") },
      mesh: { ...mesh, enabled: kept.has("mesh") },
      construction: { ...construction, enabled: kept.has("construction") },
      tracking: { ...tracking, enabled: kept.has("tracking") },
      alignment: { ...alignment, enabled: kept.has("alignment") }
    }
  }
}

/** How much further an end reaches while J is held alone: the move waits for a join, so it can be had from further off. */
export const JOIN_ONLY_REACH = 3

/** Whether `kinds` is connectors alone, under which a move stays put until an end meets one (§ Modifiers). */
export const joinsOnly = (kinds: ReadonlyArray<SnapKind>): boolean =>
  kinds.length > 0 && kinds.every((kind) => kind === "connectors")

/** `config` with the Connectors range stretched for a move that only joins. */
export const withJoinReach = (config: SnapConfig): SnapConfig => {
  const { connectors } = config.targets
  return {
    ...config,
    targets: { ...config.targets, connectors: { ...connectors, weight: connectors.weight * JOIN_ONLY_REACH } }
  }
}

/** The targets that can stop a turn (flush faces, ends facing) and a scale (the scaled face on another). */
const TURN_TARGETS: Readonly<Record<"turn" | "scale", ReadonlyArray<SnapTarget>>> = {
  turn: ["connectors", "mesh", "alignment", "grid"],
  scale: ["mesh"]
}

/**
 * How a turn or a scale snaps under `config` with `kinds` held and Ctrl held (`off`; docs/SNAPPING.md § Affect): the
 * targets it can stop on are those that are on (`targetOn`), and a held key narrows them to its kind, bringing them on
 * with the magnet off. The step is Rotate's or Scale's own switch, whatever key is held. Ctrl turns all of it off.
 */
export const turnSnapOf = (
  config: SnapConfig,
  transform: "turn" | "scale",
  kinds: ReadonlyArray<SnapKind>,
  off: boolean
): { readonly step: boolean; readonly targets: ReadonlyArray<SnapTarget> } => {
  const narrowed = narrowedTo(config, kindsFor(transform, kinds))
  if (off) return { step: false, targets: [] }
  return {
    step: transform === "turn" ? snapsRotation(config) : snapsScale(config),
    targets: priorityOf(narrowed).filter((target) => TURN_TARGETS[transform].includes(target))
  }
}

/** How far, in pixels, `target` keeps hold of a drag, and how near a pick has to be. */
export const rangeOf = (config: SnapConfig, target: SnapTarget): number => {
  if (target !== "connectors") return config.threshold
  const { range, weight } = config.targets.connectors
  return (range ?? config.threshold) * weight
}

const isWorldOrigin = ({ x, y, z }: Vec3) => x === 0 && y === 0 && z === 0

const FACE_WORDS = { keep: "keep rotation", upright: "upright", align: "align to face" } as const
const GAP_WORDS = { ortho: "gaps in ortho", always: "gaps always", never: "no gaps" } as const

/** A target's row in the priority list says this much about its parameters. */
export const targetSummary = (
  config: SnapConfig,
  target: SnapTarget,
  units: "cm" | "m",
  counts?: { readonly construction: number }
): string => {
  const { alignment, connectors, grid, mesh } = config.targets
  switch (target) {
    case "grid":
      return [
        formatGridSize(config.gridSize, units),
        isWorldOrigin(grid.origin) ? "world origin" : "own origin",
        ...(grid.yaw === 0 ? [] : [`${grid.yaw}°`])
      ].join(", ")
    case "connectors":
      return [
        `${connectors.range ?? config.threshold} px`,
        connectors.matchRotation ? "match rotation" : "keep rotation",
        ...(connectors.weight === 1 ? [] : [`pull ${formatWeight(connectors.weight)}`])
      ].join(", ")
    case "mesh": {
      const on = MESH_ELEMENTS.filter((element) => mesh.elements[element]).length
      return `${on} of ${MESH_ELEMENTS.length} elements, ${FACE_WORDS[mesh.rotateToFace]}`
    }
    case "construction":
      return counts === undefined ? "Planes and axes" : `${counts.construction} planes and axes`
    case "tracking":
      return "From remembered points"
    case "alignment":
      return `In view, ${GAP_WORDS[alignment.gapGuides]}`
  }
}

/** Scale-factor step shared by handles and fields. A known dimension uses the grid; otherwise the percent step. */
export const scaleSnapStep = (
  config: SnapConfig,
  extent: number | undefined,
  off = false
): number | undefined => {
  if (off) return undefined
  if (config.scaleToGrid && config.targets.grid.enabled && extent !== undefined && extent > 0) {
    return config.gridSize / extent
  }
  return config.scaleEnabled ? config.scaleStep / 100 : undefined
}
