/** What an approximation is asked for: the method, and what each method reads (docs/APPROXIMATE.md). */
import { type ShapeKind, shapeKinds } from "./shapes"

/** The methods, the ones made to look like the model first and the two voxel baselines after. */
export const methods = ["mixed", "platesOnly", "piecesOnly", "boxes", "voxels"] as const
export type Method = typeof methods[number]

export interface MethodInfo {
  readonly label: string
  readonly hint: string
  /** Whether it fits a low-poly mesh with plates, with or without other pieces: it reads `PlateSettings`. */
  readonly plates: boolean
  /** Whether it is the greedy fit of whole pieces: it reads `PieceSettings`. */
  readonly pieces: boolean
  /** Whether it reads the piece budget. */
  readonly budget: boolean
}

export const METHODS: Readonly<Record<Method, MethodInfo>> = {
  mixed: {
    label: "Pieces and plates",
    hint: "A low-poly mesh for the piece budget, its faces covered with flat pyramid sides and its flat patches with " +
      "cubes. Where a part or a stretch of the surface follows a sphere, half sphere, capsule, cylinder, cone or " +
      "cube, one of those stands in for it and frees its plates for the rest. The most consistent of the methods.",
    plates: true,
    pieces: false,
    budget: true
  },
  platesOnly: {
    label: "Plates only",
    hint: "A low-poly mesh for the piece budget, its faces covered with flat pyramid sides and its flat patches with " +
      "cubes. No sphere, half sphere, capsule, cylinder or cone stands in for any of it.",
    plates: true,
    pieces: false,
    budget: true
  },
  piecesOnly: {
    label: "Pieces only",
    hint: "Spheres, half spheres, capsules, cylinders, cones, pyramids and cubes only. Each separate part of the " +
      "model that is one of those takes it; the rest is fitted greedily, each new piece where most of the model is " +
      "still uncovered. The pieces are then moved, stretched, turned and dropped while the result looks more like " +
      "the model.",
    plates: false,
    pieces: true,
    budget: true
  },
  boxes: {
    label: "Merged boxes",
    hint: "Covers the voxels with as few axis-aligned scaled cubes as a greedy merge finds, largest first.",
    plates: false,
    pieces: false,
    budget: true
  },
  voxels: {
    label: "Voxel cubes",
    hint: "One cube per visible voxel: the naive baseline.",
    plates: false,
    pieces: false,
    budget: false
  }
}

/** What the greedy fit of whole pieces reads (greedy.ts), and how its polish starts (pieces.ts). */
export interface PieceSettings {
  readonly kinds: ReadonlyArray<ShapeKind>
  /** What a cell of piece one cell past the tolerance costs against one inside the model. */
  readonly outsidePenalty: number
  /** How far outside the surface, in cells, a piece may reach for free. */
  readonly tolerance: number
  /** The smallest a piece may be along any of its axes, in cells. */
  readonly minSize: number
  /** Refinement sweeps after the greedy loop. */
  readonly sweeps: number
  /** No piece covers a cell outside the model. */
  readonly noSpill: boolean
  /** Whether pieces may turn to any angle. */
  readonly rotation: boolean
  readonly seed: number
  /**
   * How much worse a shorter run of the fit's first pieces may look, in image score, and still be taken over a longer
   * one; 0 keeps the best-looking run whatever it costs.
   */
  readonly fewer: number
}

/** `PieceSettings.fewer` as the dialog offers it: Some, the default, and More. */
export const FEWER = 0.01
/**
 * Three times the default. On the goomba, duck and bunny at 100 pieces the polish starts from about half the pieces
 * Some keeps (33 to 14, 18 to 11, 40 to 21) and the result scores 0.007 to 0.021 lower.
 */
export const FEWER_MORE = 0.03

/** What the plates methods read (plates.ts). */
export interface PlateSettings {
  /** How far, in degrees, a face may turn from its patch. */
  readonly flatness: number
  /** How thick rectangular plates are, in cm; 0 for one cell, and flat regions may then span the model's depth. */
  readonly thickness: number
  /**
   * Pieces and plates: how readily primitives stand in for stretches of the surface, 0 (never) to 1; 0.5 takes one
   * where it clearly looks better.
   */
  readonly primitives: number
  /** The face count of the mesh when the budget is infinite; a finite budget searches for its own. */
  readonly faces: number
}

/** The most seconds of mesh search or polish. */
export const SEARCH_SECONDS_MAX = 20

export interface ApproximateSettings {
  readonly method: Method
  /** The most pieces the result may use. */
  readonly budget: number
  /** Cells along the model's longest side. */
  readonly resolution: number
  /** Fill the cells the model's surface passes through, so open sheets and thin parts show. */
  readonly fillThin: boolean
  /** Plates: the most seconds of local mesh search. Pieces only: seconds of polish. 0 turns either off. */
  readonly searchSeconds: number
  /** Whether pieces are tied to the model's mirror and turn symmetries where that looks no worse. */
  readonly symmetry: boolean
  readonly pieces: PieceSettings
  readonly plates: PlateSettings
  /** Stages a test or the bench leaves out to look at the rest alone. The app leaves none out. */
  readonly without?: ReadonlyArray<Stage>
}

/**
 * A stage that can be left out: `split` gives the model's separate parts primitives of their own (meshParts.ts), and
 * `profiles` covers parts that read as flat profiles with flat pieces (profile.ts).
 */
export type Stage = "split" | "profiles"

export const DEFAULT_SETTINGS: ApproximateSettings = {
  method: "mixed",
  budget: 300,
  resolution: 64,
  fillThin: true,
  searchSeconds: SEARCH_SECONDS_MAX,
  symmetry: true,
  pieces: {
    kinds: shapeKinds,
    outsidePenalty: 6,
    tolerance: 0,
    minSize: 2,
    sweeps: 2,
    noSpill: false,
    rotation: true,
    seed: 1,
    fewer: FEWER
  },
  plates: { flatness: 12, thickness: 0, primitives: 0.5, faces: 400 }
}

/**
 * What a method's order depends on: every setting but the budget and the refinement. Two runs with the same key and
 * model place the same pieces in the same order, so a smaller budget's are a prefix of a larger one's.
 */
export const orderKeyOf = ({ budget: _budget, pieces: { sweeps: _sweeps, ...pieces }, ...rest }: ApproximateSettings) =>
  JSON.stringify({ ...rest, pieces })
