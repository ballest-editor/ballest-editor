/** One model fitted whole within a piece budget: every representation tried, judged by look, then searched. */
import { vecAdd, vecScale } from "../../ueMath"
import { now } from "../clock"
import { closedGrid } from "../grid/solid"
import { type Box3, forEachSolid, gridOver, trianglesBox, type VoxelGrid, voxelize } from "../grid/voxelize"
import { drawnOver, lookOf, lookOfPlacements, modelViews, piecePictures, regionsOf } from "../look/views"
import { trianglesOfMesh } from "../mesh/mesh"
import { acuteShare, cleanSurface, PlateSource } from "../mesh/remesh"
import { type BulkPiece, bulkPrimitives } from "../parts/bulk"
import { chosenSymmetries, type MirrorSymmetry, symmetriesOf } from "../parts/symmetry"
import { thinParts } from "../parts/thinParts"
import { SEARCH_SECONDS_MAX } from "../settings"
import { IDENTITY_QUAT, type Placement } from "../shapes"
import { extrusionsOf, SWEEP_SHARE, sweepShare, type SweepTest, sweepTests } from "./extrusion"
import { candidatesOf, type Show } from "./plateCandidates"
import { fitPlates } from "./plateFit"
import { mirrorRemesh } from "./plateMirror"
import { atMostFaces, type Judged, type ModelFit, type PartsFit, partsOf, type Scored } from "./plateParts"
import { searchPlateMesh } from "./plateSearch"
import {
  type Alternative,
  emptyPaths,
  type FitOptions,
  type FittedPlates,
  type PlateOptions,
  type Plates,
  withPrimitives
} from "./plateTypes"
import { rectangularPlates } from "./slabs"
import { stripsWithin } from "./strips"

/** Seconds a budgeted fit aims to take with its search; the search gets what the fits leave, at least `SEARCH_MIN_SECONDS`. */
const PLATE_SECONDS = 24
export const SEARCH_MIN_SECONDS = 4

/** The most seconds `options` allow the mesh search; 0 turns it off. */
export const searchCap = (options: PlateOptions): number =>
  Math.max(0, Math.min(SEARCH_SECONDS_MAX, options.searchSeconds ?? SEARCH_SECONDS_MAX))

/** What the stages of one whole fit share. */
interface Fit extends ModelFit {
  readonly grid: VoxelGrid
  readonly options: PlateOptions
  /** Shows a candidate in the preview, where it looks better than what is shown. */
  readonly show: Show | undefined
}

// --- ranking ------------------------------------------------------------------------------------------------------

/**
 * How much worse, by look, a mirror-symmetric mesh may score than the best free candidate and still be chosen. The
 * look has no term for symmetry. The symmetric meshes the eye preferred (the launch star at 100, the goomba's head,
 * the teapot's body) scored up to 0.006 below the free ones, and those that lost a feature (the dorayaki tower moved
 * onto the plane at 300) 0.02 or more below: this sits between the two.
 */
const MIRROR_MARGIN = 0.01

/** A candidate's rank: its look, and `MIRROR_MARGIN` more for a symmetric mesh. */
const rankOf = (result: FittedPlates, score: number): number =>
  score + (result.mirror === undefined ? 0 : MIRROR_MARGIN)

const byRank = (a: Scored, b: Scored): number => rankOf(b.result, b.judged.score) - rankOf(a.result, a.judged.score)

/** `results` with their looks, best rank first. */
const ranked = ({ judge }: Fit, results: ReadonlyArray<FittedPlates>): Array<Scored> =>
  results.map((result) => ({ result, judged: judge(result.placements) })).sort(byRank)

/** `scored` and `more`, best rank first. */
const rankedWith = (scored: ReadonlyArray<Scored>, more: ReadonlyArray<Scored>): Array<Scored> =>
  [...scored, ...more].sort(byRank)

/** Whether a candidate is a mesh the later stages can start from. */
const isMesh = ({ result }: Scored): boolean => result.surfaceMesh !== undefined

// --- fit options --------------------------------------------------------------------------------------------------

/** `options` with the mirror `result`'s mesh was remeshed in, so a fit that starts from it stays symmetric. */
const mirrorOptions = (options: PlateOptions, result: FittedPlates): FitOptions =>
  result.mirror === undefined ? options : { ...options, mirror: result.mirror }

/** `mirrorOptions`, with the primitives `result`'s mesh was fitted round. */
const fitOptionsOf = (options: PlateOptions, result: FittedPlates): FitOptions =>
  result.covers === undefined ?
    mirrorOptions(options, result) :
    { ...mirrorOptions(options, result), covers: result.covers, coverGrow: result.coverGrow ?? 0 }

// --- reading the model --------------------------------------------------------------------------------------------

/** The least cells deep a model's thickest place should be, and the finest grid a thin one is read on to get there. */
const THIN_DEPTH = 7
const FINEST = 144

/**
 * The grid and source a budgeted fit works on. A thin model (a fox, a sheet) is only a few cells through, too few to
 * tell a leg from a fin or to find its parts: it is read again on a grid fine enough for its thickest place to be
 * `THIN_DEPTH` cells deep.
 */
const readingOf = (
  triangles: Float32Array,
  given: VoxelGrid,
  budgeted: boolean
): { readonly grid: VoxelGrid; readonly source: PlateSource } => {
  const source = new PlateSource(triangles, given)
  const deepest = source.solid.deepest, cells = Math.max(...given.n)
  const finer = Math.min(FINEST, Math.round(cells * THIN_DEPTH / Math.max(1, deepest)))
  if (!budgeted || deepest >= THIN_DEPTH || finer <= cells) return { grid: given, source }
  const grid = voxelize(triangles, gridOver(trianglesBox(triangles), finer), { surface: true })
  return { grid, source: new PlateSource(triangles, grid) }
}

/**
 * The most faces mirror detection reads: a finer model is simplified first. On the bunny (69,000 faces) that takes
 * detection from 7.9 s to 1.6 s. The sample models over the cap keep their plane to within 0.1% of their size, except
 * one whose plane barely held (88% of it mirrored), which is lost.
 */
const MIRROR_FACES = 4000

const mirrorsFound = new WeakMap<Float32Array, MirrorSymmetry | null>()

/** The model's mirror plane that holds best among those worth tying pieces by, read once per triangle list. */
const mirrorOf = (triangles: Float32Array): MirrorSymmetry | undefined => {
  let found = mirrorsFound.get(triangles)
  if (found === undefined) {
    const chosen = chosenSymmetries(symmetriesOf(atMostFaces(triangles, MIRROR_FACES)))
    found = chosen.find((symmetry): symmetry is MirrorSymmetry => symmetry.kind === "mirror") ?? null
    mirrorsFound.set(triangles, found)
  }
  return found ?? undefined
}

// --- meshes -------------------------------------------------------------------------------------------------------

/** The radius hollows are closed by, as a share of the edge a face has when the budget's faces share the surface. */
const CLOSE_SHARE = 0.5

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const

/** How far, in cells, to close `grid`'s solid for a fit within `budget` pieces: under 1 is not worth doing. */
const closingRadius = (grid: VoxelGrid, budget: number): number => {
  let shown = 0
  forEachSolid(grid, grid.cells, (x, y, z, solid) => {
    for (const [dx, dy, dz] of NEIGHBOURS) if (!solid(x + dx, y + dy, z + dz)) shown++
  })
  // About three pieces go on every two faces, and an equilateral face of edge e covers e² √3 / 4.
  const faces = Math.max(4, budget / 1.5)
  return CLOSE_SHARE * Math.sqrt(4 * shown / (Math.sqrt(3) * faces))
}

/** A source that was fitted on a grid of its own. */
interface OwnGrid {
  readonly source: PlateSource
  readonly grid: VoxelGrid
}

/** The model's solid closed over its narrow hollows and gaps, as a source; undefined where nothing would close. */
const closedSource = ({ budget, options, source, triangles }: Fit): OwnGrid | undefined => {
  const radius = options.close === false ? 0 : closingRadius(source.solid.grid, budget)
  if (radius < 1) return undefined
  const grid = closedGrid(source.solid.grid, radius)
  return { source: new PlateSource(triangles, grid, true, false, trianglesOfMesh(cleanSurface(grid))), grid }
}

/**
 * The free meshes, from four sources: the model's mesh as it is; with its coarse corners kept, which helps mechanical
 * shapes and is compared, not inferred; the clean outer voxel surface at low budgets, where a fine original spends
 * faces on hidden detail; and the solid closed over hollows and gaps much narrower than a face, which can't be shown
 * and cost the faces that could show the model's shape.
 */
const freeMeshes = (
  fit: Fit
): { readonly meshes: Array<FittedPlates>; readonly closed: OwnGrid | undefined } => {
  const { budget, grid, options, show, source } = fit
  const meshes: Array<FittedPlates> = [...candidatesOf(grid, options, source, budget, { show })]
  // Each later source starts where the ones before ended: the face counts that fit are close.
  const add = (from: PlateSource, on: VoxelGrid) => {
    const start = Math.max(...meshes.map((result) => result.faces), budget / 2)
    meshes.push(...candidatesOf(on, options, from, budget, { show, start }))
  }
  add(source.variant(source.repaired, true), grid)
  if (!source.repaired && budget <= 300) add(source.variant(true, false), grid)
  const closed = closedSource(fit)
  if (closed !== undefined) add(closed.source, closed.grid)
  return { meshes, closed }
}

/** The source of the best of `free`, fitted symmetric in `mirror`; undefined when no free mesh has a source. */
const mirroredMeshes = (
  fit: Fit,
  mirror: MirrorSymmetry,
  free: ReadonlyArray<FittedPlates>,
  closed: OwnGrid | undefined
): ReadonlyArray<FittedPlates> | undefined => {
  const { budget, grid, options, show, source } = fit
  const best = ranked(fit, free.filter((result) => result.source !== undefined))[0]?.result
  if (best?.source === undefined) return undefined
  const mirrored = { ...options, mirror: mirrorRemesh(mirror.plane, source.samples.filter((_, i) => i % 4 === 0)) }
  const on = best.source === closed?.source ? closed.grid : grid
  // The best free mesh's face count already fits the budget.
  return candidatesOf(on, mirrored, best.source, budget, { show, start: best.faces, near: true })
}

// --- whole pieces -------------------------------------------------------------------------------------------------

/** A candidate made of whole pieces, not of a mesh's faces: `patches` is how many regions they cover. */
const pieceCandidate = (
  representation: "rectangles" | "extrusion",
  placements: ReadonlyArray<Placement>,
  tag: string,
  patches: number,
  details: Pick<FittedPlates, "strips" | "extrusion"> = {}
): FittedPlates => ({
  representation,
  placements,
  tags: placements.map(() => tag),
  ...details,
  faces: 0,
  patches,
  plates: placements.length,
  triangles: 0,
  paths: emptyPaths(),
  acuteBefore: 0,
  acuteAfter: 0,
  repaired: false
})

/** Resolutions slab rectangles are first tried at, and the bisection steps between the two that straddle the budget. */
const SLAB_RESOLUTIONS = [24, 32, 40, 48, 64, 80, 96, 112, 128, 160, 192, 220]
const SLAB_COARSEST = 24
const SLAB_FINEST = 220
const SLAB_BISECTIONS = 5
/** How far either side of the finest fitting resolution a thin model is tried at every resolution. */
const SLAB_NEIGHBOURS = 8

/** An axis-aligned `piece` clipped to `bounds`, never thinner than half a centimetre. */
const clipped = (piece: Placement, bounds: Box3): Placement => {
  const center = { ...piece.center }, half = { ...piece.half }
  for (const axis of ["x", "y", "z"] as const) {
    const low = Math.max(bounds.min[axis], center[axis] - half[axis])
    const high = Math.min(bounds.max[axis], center[axis] + half[axis])
    center[axis] = (low + high) / 2
    half[axis] = Math.max(0.25, (high - low) / 2)
  }
  return { ...piece, center, half }
}

/**
 * Rectangles through the voxel solid (slabs.ts), clipped to the model's bounds, at every resolution tried whose
 * count fits the budget: counts are not monotone in the resolution, so earlier fits are kept. The resolutions go up
 * until two in a row are over the budget, then bisect between the finest that fitted and the coarsest that didn't.
 */
const slabCandidates = ({ budget, grid, show, triangles }: Fit): ReadonlyArray<FittedPlates> => {
  const candidates: Array<FittedPlates> = []
  const bounds = trianglesBox(triangles)
  const tried = new Set<number>()
  let lower = SLAB_COARSEST, upper = SLAB_FINEST
  /** Tries `resolution`, and says whether its rectangles fit the budget. */
  const fits = (resolution: number): boolean => {
    tried.add(resolution)
    const placements = rectangularPlates(voxelize(triangles, gridOver(bounds, resolution), { surface: true }))
      .map((piece) => clipped(piece, bounds))
    const within = placements.length <= budget
    if (within) {
      show?.(placements)
      candidates.push(pieceCandidate("rectangles", placements, "slab", placements.length))
      lower = Math.max(lower, resolution)
    } else upper = Math.min(upper, resolution)
    return within
  }
  let over = 0
  for (const resolution of SLAB_RESOLUTIONS) {
    over = fits(resolution) ? 0 : over + 1
    if (over === 2) break
  }
  for (let step = 0; step < SLAB_BISECTIONS; step++) {
    const resolution = Math.round((lower + upper) / 2)
    if (tried.has(resolution)) break
    fits(resolution)
  }
  // Thin models also try the neighbouring resolutions.
  if (budget <= 150 && Math.min(...grid.n) < Math.max(...grid.n) * 0.3) {
    const first = Math.max(SLAB_COARSEST, lower - SLAB_NEIGHBOURS),
      last = Math.min(SLAB_FINEST, lower + SLAB_NEIGHBOURS)
    for (let resolution = first; resolution <= last; resolution++) if (!tried.has(resolution)) fits(resolution)
  }
  return candidates
}

/** Rectangles over the mesh's nearly flat patches (strips.ts). */
const stripCandidates = ({ budget, grid, show, triangles }: Fit): ReadonlyArray<FittedPlates> =>
  stripsWithin(triangles, grid, grid.voxel, budget).map(({ flatness, minArea, patches, placements, rejected }) => {
    show?.(placements)
    return pieceCandidate("rectangles", placements, "strip", patches, {
      strips: { flatness, minArea, patches, rejected }
    })
  })

/** A profile swept along an axis, as extrusions along each axis that passes the sweep test (extrusion.ts). */
const extrusionCandidates = (
  { budget, options, show, triangles }: Fit,
  sweeps: ReadonlyArray<SweepTest>
): ReadonlyArray<FittedPlates> =>
  sweeps.filter((sweep) => sweepShare(sweep) >= SWEEP_SHARE).flatMap((sweep) =>
    extrusionsOf(triangles, sweep.axis, budget).flatMap(({ leastGain, placements, sections, uncovered }) => {
      if (placements.length === 0) return []
      if (options.round === false && placements.some((piece) => piece.kind !== "box")) return []
      show?.(placements)
      return [
        pieceCandidate("extrusion", placements, "extrusion", sections, {
          extrusion: { sections, leastGain, uncovered }
        })
      ]
    })
  )

// --- stretches of surface -----------------------------------------------------------------------------------------

/** How far a surface sample may lie under a primitive's surface and over it, in cells, to count as explained. */
const BULK_UNDER = 1.2
const BULK_PROUD = 0.4

/** How far round a primitive's samples its region of the views reaches, in cells. */
const REGION_CELLS = 2.5

/** The primitives that each explain a stretch of the model's surface (bulk.ts), most surface first. */
const bulkFound = ({ budget, source }: Fit): ReadonlyArray<BulkPiece> => {
  const voxel = source.solid.grid.voxel
  return bulkPrimitives(source.solid, source.samples, thinParts(source.solid.grid).parts, {
    tolerance: voxel * BULK_UNDER,
    proud: voxel * BULK_PROUD,
    minShare: Math.max(0.015, 1.5 / budget),
    most: Math.max(1, Math.floor(budget / 6))
  })
}

/**
 * Those of `found` that look better by `margin` than the mesh `plain` where they show, each drawn over it and over
 * those kept before it.
 */
const bulkKept = (
  { source, views }: Fit,
  found: ReadonlyArray<BulkPiece>,
  plain: ReadonlyArray<Placement>,
  margin: number
): Array<BulkPiece> => {
  let drawn = piecePictures(views.frame, plain)
  const kept: Array<BulkPiece> = []
  for (const entry of found) {
    const regions = regionsOf(views.frame, entry.points, REGION_CELLS * source.solid.grid.voxel)
    const before = lookOf(views, drawn, regions).score
    const over = drawnOver(views.frame, drawn, [entry.piece])
    const after = lookOf(views, over, regions).score
    if (after < before + margin) continue
    kept.push(entry)
    drawn = over
  }
  return kept
}

/** The source of the mesh `plain` fitted again with `kept` as covers: a face under a cover takes no pieces. */
const coveredMeshes = (
  { budget, grid, options, show, source }: Fit,
  plain: FittedPlates,
  from: PlateSource,
  kept: ReadonlyArray<BulkPiece>
): ReadonlyArray<FittedPlates> => {
  const covers = kept.map(({ piece }) => piece)
  const coverGrow = source.solid.grid.voxel * BULK_PROUD * 1.25
  // About the explained share of the faces will be hidden, so the mesh can be that much finer.
  const start = plain.faces / Math.max(0.1, 1 - 0.9 * kept.reduce((sum, entry) => sum + entry.share, 0))
  return candidatesOf(grid, { ...mirrorOptions(options, plain), covers, coverGrow }, from, budget, { show, start })
}

/**
 * Primitives for the stretches of surface that follow one, each kept where it looks better than the best plain mesh,
 * and that mesh's source fitted again round them: `won` are the fits that clearly beat the plain mesh. A primitive
 * pays by freeing pieces for the rest, so where it shows it need only look about as good as the mesh; the search
 * starts from one mesh, so a covered one takes the plain one's place only on a clear win.
 */
const bulkStage = (
  fit: Fit,
  scored: ReadonlyArray<Scored>
): { readonly kept: ReadonlyArray<BulkPiece>; readonly won: ReadonlyArray<Scored> } => {
  const { budget, judge, options, stamp } = fit
  const plain = scored.find(isMesh)
  const weight = Math.max(0, Math.min(1, options.primitives ?? 0.5))
  // What a primitive, and then the whole fit round them, must win by: 0.01 at the default weight.
  const margin = 0.03 - 0.04 * weight
  if (weight <= 0 || plain?.result.source === undefined || budget < 12) return { kept: [], won: [] }
  const found = bulkFound(fit)
  stamp("bulkFit")
  const kept = bulkKept(fit, found, plain.result.placements, margin)
  stamp("bulkJudged")
  const covered = kept.length === 0 ? [] : coveredMeshes(fit, plain.result, plain.result.source, kept)
  const won = covered.map((result): Scored => ({ result, judged: judge(result.placements) }))
    .filter(({ judged }) => judged.score >= plain.judged.score + margin)
  stamp("bulk")
  return { kept, won }
}

// --- the mesh search ----------------------------------------------------------------------------------------------

/** The seconds the mesh search gets: what is left of `PLATE_SECONDS` since `started`, within its least and its cap. */
const searchSecondsFrom = (options: PlateOptions, started: number): number => {
  const elapsed = (now() - started) / 1000
  const cap = searchCap(options)
  return cap === 0 ? 0 : Math.min(cap, Math.max(SEARCH_MIN_SECONDS, PLATE_SECONDS - elapsed))
}

/** The mesh of `from` after `seconds` of search (plateSearch.ts), every mesh tried fitted as `from` was. */
const searched = ({ budget, grid, judge, options }: Fit, from: FittedPlates, seconds: number) => {
  const { source, surfaceMesh } = from
  if (surfaceMesh === undefined || source === undefined) return undefined
  const fitGrid = from.fitGrid ?? grid
  const fitOptions = fitOptionsOf(options, from)
  const primitives = from.primitives ?? []
  return searchPlateMesh(surfaceMesh, source, seconds, (mesh) => {
    const fitted = fitPlates(fitGrid, fitOptions, source, mesh)
    const result = withPrimitives(
      { ...fitted, acuteBefore: from.acuteBefore, acuteAfter: acuteShare(mesh) },
      primitives,
      fitGrid
    )
    if (result.placements.length > budget) return undefined
    return { result, score: judge(result.placements).score }
  }, from.mirror?.plane)
}

/**
 * The best of `scored`, best first, after `seconds` of mesh search. The best mesh is searched even if another
 * representation leads, then all are compared again. A symmetric mesh leads on `MIRROR_MARGIN`, judged before the
 * search, and the search can gain a free mesh more than that (the tower at 300: 0.011): the best free mesh is then
 * searched too, each on half the time, and the margin applies again to what the two come to.
 */
const searchedBest = (fit: Fit, scored: ReadonlyArray<Scored>, seconds: number): FittedPlates | undefined => {
  const leader = scored[0]
  if (leader === undefined || seconds <= 0) return leader?.result
  const meshes = scored.map(({ result }) => result)
    .filter((result) => result.surfaceMesh !== undefined && result.source !== undefined)
  const first = meshes[0]
  const rival = first?.mirror === undefined ? undefined : meshes.find((result) => result.mirror === undefined)
  const starts = [first, rival].filter((result) => result !== undefined)
  let best = leader.result, rank = rankOf(leader.result, leader.judged.score)
  for (const from of starts) {
    const found = searched(fit, from, seconds / starts.length)
    if (found === undefined) continue
    const foundRank = rankOf(found.result, found.stats.after)
    if (foundRank > rank) {
      rank = foundRank
      best = { ...found.result, search: found.stats }
    } else if (from === first) best = { ...best, search: found.stats }
  }
  return best
}

// --- the result ---------------------------------------------------------------------------------------------------

/** A budget too small even for four faces gets the model's bounds as one cube, never a shell cut open. */
const boundsOf = (triangles: Float32Array, budget: number, repaired: boolean): Plates => {
  const { max, min } = trianglesBox(triangles)
  const half = (axis: "x" | "y" | "z") => Math.max(0.25, (max[axis] - min[axis]) / 2)
  const cube: Placement = {
    kind: "box",
    center: vecScale(vecAdd(min, max), 0.5),
    half: { x: half("x"), y: half("y"), z: half("z") },
    rotation: IDENTITY_QUAT
  }
  return {
    representation: "bounds",
    placements: budget < 1 ? [] : [cube],
    faces: 12,
    patches: 6,
    plates: 1,
    triangles: 0,
    paths: { ...emptyPaths(), rectangle: 12 },
    acuteBefore: 0,
    acuteAfter: 0,
    repaired
  }
}

/** A fit without what it keeps to itself: the rest is the report. */
const publicResult = (
  {
    coverGrow: _grow,
    covers: _covers,
    fitGrid: _grid,
    mirror: _mirror,
    primitives: _primitives,
    source: _source,
    surfaceMesh: _mesh,
    ...result
  }: FittedPlates
): Plates => result

/** The best of each representation before the search, for the report. */
const alternativesOf = (scored: ReadonlyArray<Scored>): NonNullable<Plates["alternatives"]> => {
  const bestOf = (representation: Plates["representation"]): Alternative | undefined => {
    const found = scored.find(({ result }) => result.representation === representation)
    if (found === undefined) return undefined
    return {
      pieces: found.result.placements.length,
      ...found.judged,
      placements: found.result.placements,
      tags: found.result.tags ?? []
    }
  }
  const mesh = bestOf("mesh"), rectangles = bestOf("rectangles"), extrusion = bestOf("extrusion")
  return {
    ...(mesh === undefined ? {} : { mesh }),
    ...(rectangles === undefined ? {} : { rectangles }),
    ...(extrusion === undefined ? {} : { extrusion })
  }
}

/** The primitives among `bulk` that `best`'s mesh was fitted round, for the report. */
const bulkReport = (best: FittedPlates, bulk: ReadonlyArray<BulkPiece>): Pick<Plates, "bulk"> => {
  if (best.covers === undefined) return {}
  const used = new Set(best.covers)
  return {
    bulk: bulk.filter(({ piece }) => used.has(piece)).map(({ piece, share, spill }) => ({
      kind: piece.kind,
      share,
      spill
    }))
  }
}

// --- the fit ------------------------------------------------------------------------------------------------------

/** How `placements` look against the model, worked out once for each list. */
const judgeOf = (views: Fit["views"]): Fit["judge"] => {
  const known = new Map<ReadonlyArray<Placement>, Judged>()
  return (placements) => {
    const kept = known.get(placements)
    if (kept !== undefined) return kept
    const judged = lookOfPlacements(views, placements)
    known.set(placements, judged)
    return judged
  }
}

/** Passes on to `onCandidate` each candidate that looks better than the last it passed, whichever representation. */
const showOf = (judge: Fit["judge"], onCandidate: Show | undefined): Show | undefined => {
  if (onCandidate === undefined) return undefined
  let shown = -Infinity
  return (placements) => {
    const { score } = judge(placements)
    if (score <= shown) return
    shown = score
    onCandidate(placements)
  }
}

/** Adds the time since the last stamp, or since `started`, to a stage's seconds in `seconds`. */
const stampOf = (seconds: Record<string, number>, started: number): Fit["stamp"] => {
  let lap = started
  return (stage) => {
    const stamped = now()
    seconds[stage] = (seconds[stage] ?? 0) + (stamped - lap) / 1000
    lap = stamped
  }
}

/**
 * Every representation of the model within the budget: free and symmetric meshes, slabs, strips and extrusions, with
 * the sweep tests the extrusions were chosen by, likeliest axis first.
 */
const representations = (
  fit: Fit,
  mirror: MirrorSymmetry | undefined
): { readonly candidates: Array<FittedPlates>; readonly sweeps: ReadonlyArray<SweepTest> } => {
  const { options, stamp, triangles } = fit
  const { closed, meshes: candidates } = freeMeshes(fit)
  stamp("mesh")
  const mirrored = mirror === undefined ? undefined : mirroredMeshes(fit, mirror, candidates, closed)
  if (mirrored !== undefined) {
    candidates.push(...mirrored)
    stamp("mirror")
  }
  // A manual thickness rules out rectangles through the model's depth.
  if (options.thickness === 0) {
    candidates.push(...slabCandidates(fit))
    stamp("slabs")
    candidates.push(...stripCandidates(fit))
  }
  stamp("strips")
  const sweeps = sweepTests(triangles)
  candidates.push(...extrusionCandidates(fit, sweeps))
  stamp("extrusions")
  return { candidates, sweeps }
}

/** Thin parts as primitives over the best mesh of `scored` (plateParts.ts), unless the options leave them out. */
const partsStage = (fit: Fit, scored: ReadonlyArray<Scored>): PartsFit | undefined => {
  const full = scored.find(isMesh)
  if (fit.options.parts === false || full === undefined) return undefined
  return partsOf(fit, fitOptionsOf(fit.options, full.result), full)
}

/**
 * The model fitted whole. With a budget, every representation is tried within it (free and symmetric meshes, slab
 * rectangles, strips, extrusions), the best mesh is fitted again round primitives for stretches of surface and for
 * thin parts, and the mesh search then works on the best; the look (views.ts) picks at each step. Core fill never
 * takes pieces from the shell. Without a budget it is one mesh of `options.faces` faces.
 */
export const platesWhole = (
  triangles: Float32Array,
  given: VoxelGrid,
  options: PlateOptions,
  onCandidate?: Show
): Plates => {
  const budget = options.budget
  const budgeted = budget !== undefined && Number.isFinite(budget)
  const { grid, source } = readingOf(triangles, given, budgeted)
  if (!budgeted) return publicResult(fitPlates(grid, options, source))
  // Found before the clock starts, so the search keeps its time on a model without a mirror.
  const detecting = now()
  const mirror = options.symmetry === false ? undefined : mirrorOf(triangles)
  const started = now()
  const seconds: Record<string, number> = options.symmetry === false ? {} : { symmetry: (started - detecting) / 1000 }
  const stamp = stampOf(seconds, started)
  const views = modelViews(triangles)
  const judge = judgeOf(views)
  const fit: Fit = { triangles, grid, source, options, budget, views, judge, show: showOf(judge, onCandidate), stamp }

  const { candidates, sweeps } = representations(fit, mirror)
  const fitted = ranked(fit, candidates)
  stamp("score")
  const bulk = bulkStage(fit, fitted)
  const covered = rankedWith(fitted, bulk.won)
  const parts = partsStage(fit, covered)
  const scored = parts?.combined === undefined ? covered : rankedWith(covered, [parts.combined])
  stamp("parts")
  const best = searchedBest(fit, scored, searchSecondsFrom(options, started))
  stamp("search")
  seconds["total"] = (now() - started) / 1000
  if (best === undefined) return boundsOf(triangles, budget, source.repaired)
  const sweep = sweeps[0]
  return publicResult({
    ...best,
    ...(parts === undefined ? {} : { parts: parts.choices }),
    ...bulkReport(best, bulk.kept),
    ...(mirror === undefined ? {} : { symmetric: best.mirror !== undefined }),
    stages: seconds,
    ...(sweep === undefined ? {} : { sweep: { along: sweep.along, ends: sweep.ends } }),
    alternatives: alternativesOf(scored)
  })
}
