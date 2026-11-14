/**
 * The plates methods: the model fitted whole (platesWhole.ts), then with its separate parts as one primitive each,
 * then with its flat profiles covered by flat pieces, each kept where it looks more like the model.
 */
import { now } from "../clock"
import { gridOver, trianglesBox, type VoxelGrid, voxelize } from "../grid/voxelize"
import {
  drawnOver,
  type Look,
  lookOf,
  lookOfPlacements,
  type ModelViews,
  modelViews,
  piecePictures
} from "../look/views"
import { bigParts, componentPiece, measured, SMALL_CELLS, splitComponents } from "../parts/meshParts"
import type { Placement } from "../shapes"
import type { Show } from "./plateCandidates"
import { platesWhole, SEARCH_MIN_SECONDS, searchCap } from "./platesWhole"
import type { PlateOptions, Plates } from "./plateTypes"
import { narrowed, profileSplit } from "./profile"

/** Pieces that stand in for part of a fit or all of it, each with its path. */
interface Cover {
  readonly placements: ReadonlyArray<Placement>
  readonly tags?: ReadonlyArray<string>
}

const tagsOf = ({ placements, tags }: Cover): ReadonlyArray<string> => tags ?? placements.map(() => "")

/** A grid of `triangles`' own, as fine as `given`: part of a model fills its grid as the whole model filled its own. */
const ownGrid = (triangles: Float32Array, given: VoxelGrid): VoxelGrid =>
  voxelize(triangles, gridOver(trianglesBox(triangles), Math.max(...given.n)), { surface: true })

// --- separate parts -----------------------------------------------------------------------------------------------

/** The most of the budget the model's separate parts may take, one primitive each. */
const LIMB_SHARE = 0.4
/** What the kept parts must add to the body's score between them: less is within what one fit differs from the next. */
const LIMB_GAIN = 0.01
/** The most separate parts tried: the largest ones. */
const LIMBS_MOST = 48
/** The least budget whose parts are tried. */
const LIMBS_LEAST = 12
/** What the fit of the body leaves out while the parts are chosen over it. */
const BODY_QUICK = { searchSeconds: 0, parts: false, primitives: 0, symmetry: false } as const

type LimbFit = ReturnType<typeof componentPiece>

/**
 * The parts worth their piece over the body's pieces, `room` at most, and the look they add between them. Each is
 * tried alone first; then, most gained first, a part joins while it still looks better over those kept before it.
 */
const limbsKept = (
  views: ModelViews,
  body: ReadonlyArray<Placement>,
  limbs: ReadonlyArray<LimbFit>,
  room: number
): { readonly kept: Array<Placement>; readonly gain: number } => {
  let drawn = piecePictures(views.frame, body), score = lookOf(views, drawn).score
  /** `pieces` over what is drawn so far. */
  const over = (pieces: ReadonlyArray<Placement>) => {
    const pictures = drawnOver(views.frame, drawn, pieces)
    return { pictures, score: lookOf(views, pictures).score }
  }
  const before = score
  const alone = limbs.map((limb) => ({ limb, gain: over([limb.piece]).score - before }))
    .sort((a, b) => b.gain - a.gain)
  const kept: Array<Placement> = []
  for (const { gain, limb } of alone) {
    if (kept.length >= room || gain <= 0) break
    const plain = over([limb.piece])
    if (plain.score <= score) continue
    // Only a part that is kept is worth refining, and the refined piece stays only if it looks better here too.
    const refined = limb.refined(), nudged = over([refined])
    const better = nudged.score > plain.score
    kept.push(better ? refined : limb.piece)
    drawn = better ? nudged.pictures : plain.pictures
    score = Math.max(nudged.score, plain.score)
  }
  return { kept, gain: score - before }
}

/**
 * `platesWhole`, with the model's separate small, long and thin parts each given one primitive of their own
 * (meshParts.ts) where that looks better over the rest, and the rest, the body, fitted alone on a grid of its own with
 * what is left of the budget. The parts are chosen over a quick fit of the body that leaves room for as many as may be
 * kept; unless they clearly look better there, they stay in the mesh.
 */
const platesWithLimbs = (
  triangles: Float32Array,
  given: VoxelGrid,
  options: PlateOptions,
  onCandidate?: Show
): Plates => {
  const budget = options.budget
  const whole = () => platesWhole(triangles, given, options, onCandidate)
  if (budget === undefined || !Number.isFinite(budget) || budget < LIMBS_LEAST || options.split === false) {
    return whole()
  }
  const started = now()
  const split = splitComponents(triangles, given.voxel)
  if (split === undefined) return whole()
  const room = Math.floor(budget * LIMB_SHARE)
  const limbs = split.limbs.slice(0, Math.min(LIMBS_MOST, Math.max(10, 2 * room))).map(componentPiece)
  const fitted = now()
  const grid = ownGrid(split.body, given)
  const cap = searchCap(options)
  /** The body alone within `pieces`, shown with `beside`; the search of the last fit gets what time is left. */
  const body = (pieces: number, quick: boolean, beside: ReadonlyArray<Placement>) =>
    platesWhole(
      split.body,
      grid,
      {
        ...options,
        budget: pieces,
        ...(quick ? BODY_QUICK : cap === 0 ? {} : {
          searchSeconds: Math.max(SEARCH_MIN_SECONDS, cap - (now() - started) / 1000)
        })
      },
      onCandidate === undefined ? undefined : (placements) => onCandidate([...placements, ...beside])
    )
  const first = body(budget - Math.min(room, limbs.length), true, [])
  const { gain, kept } = limbsKept(modelViews(triangles), first.placements, limbs, room)
  if (gain < LIMB_GAIN) return whole()
  const chosen = now()
  const final = body(budget - kept.length, false, kept)
  return {
    ...final,
    placements: [...final.placements, ...kept],
    tags: [...tagsOf(final), ...kept.map(() => "component")],
    components: { limbs: split.limbs.length, kept: kept.length, gain },
    stages: {
      ...final.stages,
      componentFits: (fitted - started) / 1000,
      componentsChosen: (chosen - fitted) / 1000,
      total: (now() - started) / 1000
    }
  }
}

// --- what profiles and large parts leave --------------------------------------------------------------------------

/** The fewest pieces kept for the remainder's own fit when it has a body. */
const REMAINDER_LEAST = 12
/**
 * What the fit of a remainder with a body leaves out: mesh search, primitives, closing and its own parts split. On the
 * gravity room bridge that fit takes 9 s where the full one takes 59.
 */
const REMAINDER_QUICK = { ...BODY_QUICK, close: false } as const
/**
 * The most of the remainder's parts, largest first, nudged to look more like themselves (`componentPiece`): about 0.4 s
 * each, and on the launch star worth 0.008 of look over the plain fit.
 */
const REFINED_MOST = 8

/**
 * What a model's profiles or large parts leave, within `pieces`: nothing; its separate parts one primitive each when
 * every one suits that, the largest refined; or, when `body` allows, the whole fit, quickly, on a grid of its own.
 * Undefined when it can't fit in `pieces`.
 */
const remainderOf = (
  remainder: Float32Array,
  given: VoxelGrid,
  options: PlateOptions,
  pieces: number,
  body: boolean
): Cover | undefined => {
  if (remainder.length === 0) return { placements: [] }
  const parts = splitComponents(remainder, given.voxel, false)
  if (parts?.body.length === 0 && parts.limbs.length <= pieces) {
    return {
      placements: parts.limbs.map((limb, rank) => {
        const fit = componentPiece(limb)
        return rank < REFINED_MOST ? fit.refined() : fit.piece
      }),
      tags: parts.limbs.map(() => "component")
    }
  }
  if (!body || pieces < REMAINDER_LEAST) return undefined
  return platesWhole(remainder, ownGrid(remainder, given), { ...options, budget: pieces, ...REMAINDER_QUICK })
}

/** `pieces`, tagged `tag`, in front of the remainder `rest`. */
const coverOver = (pieces: ReadonlyArray<Placement>, tag: string, rest: Cover): Required<Cover> => ({
  placements: [...pieces, ...rest.placements],
  tags: [...pieces.map(() => tag), ...tagsOf(rest)]
})

// --- flat profiles ------------------------------------------------------------------------------------------------

/** The look a smaller profile cover may lose against the best one: twice what one fit's look differs from the next. */
const PROFILE_MARGIN = 0.01
/** ...though neither its outline nor its facing may lose more than half of that. */
const PROFILE_MARGIN_PART = 0.005
/** Shorter sides of profile pieces tried at these shares: bars that touch read apart when narrower. */
const PROFILE_NARROW = [0.85, 1] as const
/** Profile pieces' thickness tried at these shares: a bevelled edge reads thinner than the part's full depth. */
const PROFILE_DEPTH = [0.7, 1] as const
/**
 * A remainder with a body is fitted only when the profiles hold at least this share of the model's surface: it costs
 * nearly a whole fit. On scenery, where profiles are a tenth of the surface, the fit without profiles stands.
 */
const PROFILE_SHARE_BODY = 0.5

type ProfileParts = ReturnType<typeof profileSplit>["parts"]

/** The k-th cover of every part together, the last standing in for parts with fewer: those within `budget`. */
const coversTogether = (parts: ProfileParts, budget: number): Array<Array<Placement>> => {
  const count = Math.max(...parts.map((part) => part.covers.length))
  return Array.from(
    { length: count },
    (_, k) => parts.flatMap((part) => part.covers[Math.min(k, part.covers.length - 1)]?.placements ?? [])
  )
    .filter((cover) => cover.length <= budget)
}

/** A cover's pieces at one width and thickness, and how they look over the remainder. */
interface ProfileCandidate {
  readonly pieces: ReadonlyArray<Placement>
  readonly look: Look
}

/** The fewest pieces among `candidates` that look about as good as the best of them, the best-looking of those. */
const fewestNearBest = (candidates: ReadonlyArray<ProfileCandidate>): ProfileCandidate | undefined => {
  const best = candidates.toSorted((a, b) => b.look.score - a.look.score)[0]
  if (best === undefined) return undefined
  const near = candidates.filter(({ look }) =>
    look.score >= best.look.score - PROFILE_MARGIN
    && look.silhouette >= best.look.silhouette - PROFILE_MARGIN_PART
    && look.normal >= best.look.normal - PROFILE_MARGIN_PART
  )
  return near.sort((a, b) => a.pieces.length - b.pieces.length || b.look.score - a.look.score)[0] ?? best
}

/**
 * The model's flat profiles (profile.ts) each covered by a few flat pieces, over what they leave, if that looks
 * better than `baseline`. The remainder leaves room for the largest cover, so every cover is tried over the same one,
 * at each width and thickness.
 */
const profileCover = (
  triangles: Float32Array,
  given: VoxelGrid,
  options: PlateOptions,
  budget: number,
  baseline: ReadonlyArray<Placement>
): Required<Cover> | undefined => {
  const split = profileSplit(triangles, { budget, least: SMALL_CELLS * given.voxel })
  if (split.parts.length === 0) return undefined
  const covers = coversTogether(split.parts, budget)
  if (covers.length === 0) return undefined
  const share = split.parts.reduce((sum, part) => sum + part.area, 0) / measured(triangles).area
  const room = budget - Math.max(...covers.map((cover) => cover.length))
  const rest = remainderOf(split.remainder, given, options, room, share >= PROFILE_SHARE_BODY)
  if (rest === undefined) return undefined
  const views = modelViews(triangles)
  const drawn = piecePictures(views.frame, rest.placements)
  const candidates = covers.flatMap((cover) =>
    PROFILE_NARROW.flatMap((narrow) =>
      PROFILE_DEPTH.map((depth): ProfileCandidate => {
        const pieces = cover.map((piece) => narrowed(piece, narrow, depth))
        return { pieces, look: lookOf(views, drawnOver(views.frame, drawn, pieces)) }
      })
    )
  )
  const chosen = fewestNearBest(candidates)
  if (chosen === undefined || chosen.look.score <= lookOfPlacements(views, baseline).score) return undefined
  return coverOver(chosen.pieces, "profile", rest)
}

// --- large parts --------------------------------------------------------------------------------------------------

/**
 * The model's large parts that each look like one primitive as that primitive, over a quick fit of what they leave,
 * if that looks more like the model than `fitted` does: a capsule-shaped tower as its two halves' primitives, where
 * 300 plates leave a lumpy barrel.
 */
const wholeCover = (
  triangles: Float32Array,
  given: VoxelGrid,
  options: PlateOptions,
  budget: number,
  fitted: ReadonlyArray<Placement>
): Required<Cover> | undefined => {
  const big = bigParts(triangles)
  if (big === undefined || big.pieces.length > budget) return undefined
  const rest = remainderOf(big.rest, given, options, budget - big.pieces.length, true)
  if (rest === undefined) return undefined
  const cover = coverOver(big.pieces, "component", rest)
  const views = modelViews(triangles)
  if (lookOfPlacements(views, cover.placements).score <= lookOfPlacements(views, fitted).score) return undefined
  return cover
}

// --- the method ---------------------------------------------------------------------------------------------------

/**
 * `fit` with `cover`'s pieces in place of its own, where there is a cover, and the seconds `stage` took. A cover's
 * remainder is a quick fit, never a symmetric one.
 */
const coveredBy = (fit: Plates, cover: Required<Cover> | undefined, stage: string, seconds: number): Plates => ({
  ...fit,
  ...cover,
  ...(cover === undefined || fit.symmetric === undefined ? {} : { symmetric: false }),
  stages: { ...fit.stages, [stage]: seconds }
})

/**
 * The model as plates within `options.budget` pieces. The fit with separate parts (`platesWithLimbs`) stands unless
 * the model's flat profiles, and then its large parts that are one primitive each, look better as pieces of their own
 * over a fit of the remainder. `onCandidate` is called with what there is to show as the fit goes.
 */
export const plates = (
  triangles: Float32Array,
  given: VoxelGrid,
  options: PlateOptions,
  onCandidate?: Show
): Plates => {
  const baseline = platesWithLimbs(triangles, given, options, onCandidate)
  const budget = options.budget
  if (options.profiles === false || budget === undefined || !Number.isFinite(budget) || budget < REMAINDER_LEAST) {
    return baseline
  }
  const started = now()
  const profiles = profileCover(triangles, given, options, budget, baseline.placements)
  if (profiles !== undefined) onCandidate?.(profiles.placements)
  const profiled = now()
  const covered = coveredBy(baseline, profiles, "profile", (profiled - started) / 1000)
  const whole = options.split === false ? undefined : wholeCover(triangles, given, options, budget, covered.placements)
  if (whole !== undefined) onCandidate?.(whole.placements)
  return coveredBy(covered, whole, "wholeParts", (now() - profiled) / 1000)
}
