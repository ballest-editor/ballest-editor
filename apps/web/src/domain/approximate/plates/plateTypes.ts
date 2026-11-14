/** What a plates fit is asked for and what it reports (plates.ts). */
import type { VoxelGrid } from "../grid/voxelize"
import type { Look } from "../look/views"
import type { Mesh } from "../mesh/mesh"
import type { PlateSource } from "../mesh/remesh"
import type { Placement } from "../shapes"
import type { MirrorRemesh } from "./plateMirror"
import type { SearchStats } from "./plateSearch"

export interface PlateOptions {
  /** The face budget the mesh is simplified to. */
  readonly faces: number
  /** The most seconds the mesh search may take; 0 turns it off. */
  readonly searchSeconds?: number
  /** With a piece budget, whole meshes are searched for the one that fits it. */
  readonly budget?: number
  /** How far, in degrees, a face's direction may stray from its patch's. */
  readonly flatness: number
  /** How thick the plates are, in cm; 0 for one voxel of the grid. */
  readonly thickness: number
  /** Whether thin parts may become catalog primitives; on unless false. */
  readonly parts?: boolean
  /**
   * How readily primitives stand in for stretches of the surface (bulk.ts), 0 to 1: 0 never, 0.5 where they clearly
   * look better than the plain mesh, 1 even where they look a little worse. 0.5 when absent.
   */
  readonly primitives?: number
  /** Whether the solid closed over its narrow hollows and gaps may be fitted too; on unless false. */
  readonly close?: boolean
  /** Whether the model's separate parts may each take a primitive of their own (meshParts.ts); on unless false. */
  readonly split?: boolean
  /** Whether parts that read as flat profiles may be covered by flat pieces of their own (profile.ts); on unless false. */
  readonly profiles?: boolean
  /** Whether an extrusion may use cylinders; on unless false, when only one made of cubes is tried. */
  readonly round?: boolean
  /**
   * Whether, where the model has a mirror plane, a mirror-symmetric mesh is fitted too (plateMirror.ts) and kept when
   * it looks about as good as the rest; on unless false.
   */
  readonly symmetry?: boolean
  /** Primitives already standing in for part of the surface: the faces they hide take no pieces. */
  readonly covers?: ReadonlyArray<Placement>
  /** How far, in cm, a face may stand proud of `covers` and still count as hidden. */
  readonly coverGrow?: number
}

/**
 * What happened to one thin part: the candidate that stood for it (the best eligible one, or the best of all when none
 * was), how much of the part it covers and how much of it spills out of the model, and how the part's region of the
 * views and the whole model look with it and without.
 */
export interface PartChoice {
  readonly cells: number
  /** The part's thickness over its width: a flat part was tried with flat pieces only. */
  readonly flatness: number
  readonly label: string
  readonly pieces: number
  readonly coverage: number
  readonly spill: number
  readonly eligible: boolean
  readonly region?: Look
  readonly regionWithout?: Look
  readonly whole?: Look
  readonly wholeWithout?: Look
  readonly kept: boolean
}

/** One representation's best, for the report. */
export interface Alternative extends Look {
  readonly pieces: number
  readonly placements: ReadonlyArray<Placement>
  readonly tags: ReadonlyArray<string>
}

/** How many faces went each way (plateFit.ts), and how often a piece was thinned. */
export interface PlatePaths {
  /** Acute faces covered by one pyramid side. */
  one: number
  /** Faces covered by two overlapping pyramid sides. */
  overlap: number
  /** Acute faces that went to lenses because a hidden corner of their pyramid left the solid. */
  lensDepth: number
  /** Acute faces that went to lenses because an edge or the inside of their pyramid left the solid. */
  lensProtrusion: number
  /** As `lensDepth` and `lensProtrusion`, for a face that isn't acute and one of whose pair of pyramids failed. */
  splitDepth: number
  splitProtrusion: number
  /** Faces that aren't acute and that no acute pair covers, which went to lenses. */
  splitNonAcute: number
  /** Faces under a patch's rectangles. */
  rectangle: number
  /** Patches whose rectangles would stick out of the low-poly solid, so their faces went the triangle way. */
  rectangleRejected: number
  /** Lenses and rectangles thinned to fit the low-poly solid, once for every halving. */
  thinned: number
  /** Faces a bulk primitive hides, which take no pieces. */
  hidden: number
}

export const emptyPaths = (): PlatePaths => ({
  one: 0,
  overlap: 0,
  lensDepth: 0,
  lensProtrusion: 0,
  splitDepth: 0,
  splitProtrusion: 0,
  splitNonAcute: 0,
  rectangle: 0,
  rectangleRejected: 0,
  thinned: 0,
  hidden: 0
})

/** What the method made and how: for the report and the dialog. */
export interface Plates {
  readonly cornerLocked?: boolean
  readonly search?: SearchStats
  readonly parts?: ReadonlyArray<PartChoice>
  /** The primitives standing in for stretches of the surface, and the share of it each explains. */
  readonly bulk?: ReadonlyArray<{ readonly kind: string; readonly share: number; readonly spill: number }>
  readonly representation: "mesh" | "rectangles" | "extrusion" | "bounds"
  readonly placements: ReadonlyArray<Placement>
  readonly faces: number
  readonly patches: number
  /** How many of the placements are rectangles over patches, and how many cover single faces. */
  readonly plates: number
  readonly triangles: number
  readonly paths: PlatePaths
  /** The model's separate parts that could each take one primitive, and how many did. */
  readonly components?: { readonly limbs: number; readonly kept: number; readonly gain: number }
  /** Seconds each stage took. */
  readonly stages?: Readonly<Record<string, number>>
  /** The best of each representation before the search, as the look scored it. */
  readonly alternatives?: {
    readonly mesh?: Alternative
    readonly rectangles?: Alternative
    readonly extrusion?: Alternative
  }
  /** The sweep test on the model's likeliest axis: the shares of its surface along the axis and square to it. */
  readonly sweep?: { readonly along: number; readonly ends: number }
  /** For an extrusion: its sections, the least share of a section each piece covered, and the volume left uncovered. */
  readonly extrusion?: { readonly sections: number; readonly leastGain: number; readonly uncovered: number }
  /** For rectangles over the mesh's patches: the flatness and smallest patch area that fit, and rectangles dropped. */
  readonly strips?: {
    readonly flatness: number
    readonly minArea: number
    readonly patches: number
    readonly rejected: number
  }
  /** Each placement's path ("one", "pair", "lens", "rectangle", "part", "strip", "slab", "extrusion"), for renders. */
  readonly tags?: ReadonlyArray<string>
  /** The share of acute faces before and after the remesh fitted the mesh back to the model. */
  readonly acuteBefore: number
  readonly acuteAfter: number
  /** Whether the mesh started from the voxel surface, the model's own being open or non-manifold. */
  readonly repaired: boolean
  /** Where the model has a mirror plane: whether the chosen mesh is symmetric in it. */
  readonly symmetric?: boolean
}

/** Options for one fit: with `mirror`, the mesh is remeshed mirror-symmetric. */
export interface FitOptions extends PlateOptions {
  readonly mirror?: MirrorRemesh
}

/** One fit with what a later stage needs to fit it again: its mesh and source, and what it was fitted round. */
export interface FittedPlates extends Plates {
  readonly surfaceMesh?: Mesh
  readonly source?: PlateSource
  /** The mirror the mesh was remeshed symmetric in. */
  readonly mirror?: MirrorRemesh
  /** The grid the mesh was fitted on, when parts were taken out of it. */
  readonly fitGrid?: VoxelGrid
  /** Primitives standing in for thin parts, placed before the mesh's pieces. */
  readonly primitives?: ReadonlyArray<Placement>
  /** The bulk primitives the mesh was fitted round, and how far a face may stand proud of them. */
  readonly covers?: ReadonlyArray<Placement>
  readonly coverGrow?: number
}

/** `fitted` with `primitives` in front of its own pieces. */
export const withPrimitives = (
  fitted: FittedPlates,
  primitives: ReadonlyArray<Placement>,
  grid: VoxelGrid
): FittedPlates => ({
  ...fitted,
  fitGrid: grid,
  primitives,
  placements: [...primitives, ...fitted.placements],
  tags: [...primitives.map(() => "part"), ...(fitted.tags ?? [])]
})
