// The cap survey (docs/qa/connectors.md § The survey): every directional piece's ends, read off its mesh, as
// connectors.json holds them. `extract connectors` runs it, prints what it found and, with --write, writes
// connectors.json and the catalog's copy.
import { Console, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import {
  type CapMeasure,
  capsOf,
  capUp,
  cross,
  dot,
  type FlatFace,
  length,
  measureCap,
  type Mesh,
  meshOf,
  rotateAbout,
  scale,
  squareTo,
  sub,
  surfaceFrom,
  touches
} from "./caps.ts"
import { type Cap, ConnectorsFile, type End } from "./connectorsFile.ts"
import { loadTriangles, type Vec } from "./glb.ts"
import { nth } from "./nth.ts"
import { type Profile, profileOf } from "./profiles.ts"

/** The palette categories whose pieces are runs of track, and the pieces elsewhere that are. */
const SURVEYED_CATEGORIES: ReadonlySet<string> = new Set(["Tracks", "Ramps", "Pipes", "Tubes"])
const SURVEYED_PIECES: ReadonlySet<string> = new Set([
  "BP_Misc_Pinched1", // Pinched Bridge: a track
  "Bevel_Arch", // Bevel_S Arch T: a Bevel_F arch standing on two ends
  "Bevel_Rail", // Bevel_P Rail: rails meet end to end
  "BP_Elevator" // a platform: surveyed to show it has no ends
])
/** Pieces whose matching caps aren't all ends. Track S is square: its ends are its two on X, as Track M's and L's. */
const ENDS_ALONG: Readonly<Record<string, Vec>> = { BP_Track_Short1: [1, 0, 0] }

/** A cap the survey found that no profile takes, for the report. */
export interface Unmatched {
  readonly forward: Vec
  readonly area: number
  readonly width: number
  readonly height: number
  readonly centre: Vec
}

/** An end facing this close to straight up or down has no up from +Z. */
const VERTICAL = Math.cos((0.5 * Math.PI) / 180)
/** A quarter turn: a vertical end is tried at four, and its sides may roll half of one from +X. */
const QUARTER = Math.PI / 2

const roundTo = (digits: number) => (n: number) => {
  const k = 10 ** digits
  const r = Math.round(n * k) / k
  return r === 0 ? 0 : r
}
const cm = roundTo(3)
const unit = roundTo(6)
const tuple = (v: Vec, f: (n: number) => number): Vec => [f(v[0]), f(v[1]), f(v[2])]

interface Found {
  readonly face: FlatFace
  readonly profile: Profile
  readonly measure: CapMeasure
}

/** The cap seen square to itself with each of the four ups a quarter turn apart from `up`, the ones a profile takes. */
const framings = (mesh: Mesh, face: FlatFace, up: Vec, quarters: ReadonlyArray<number>) =>
  quarters.flatMap((k) => {
    const turned = squareTo(rotateAbout(up, face.normal, k * QUARTER), face.normal)
    const measure = measureCap(mesh, face, turned)
    const profile = profileOf(measure)
    return profile === undefined ? [] : [{ measure, profile }]
  })

const round = (shape: CapMeasure["shape"]) => shape.shape === "circle" || shape.shape === "annulus"

/**
 * Picks the up of a vertical end among its framings. A round cap takes the up a horizontal end of the piece carries
 * round to it, turned the shortest way; an oriented one the side the running surface from that end reaches; failing
 * those, the side toward the piece's middle (a U's ends face it), and failing that +X.
 */
const verticalUp = (
  mesh: Mesh,
  face: FlatFace,
  options: ReadonlyArray<{ readonly measure: CapMeasure; readonly profile: Profile }>,
  reference: Found | undefined
) => {
  const [first] = options
  if (first === undefined) return undefined
  if (reference !== undefined && round(first.measure.shape)) {
    const heading = scale(reference.measure.forward, -1)
    const axis = cross(heading, face.normal)
    const angle = Math.atan2(length(axis), dot(heading, face.normal))
    const up = squareTo(
      length(axis) < 1e-9
        ? reference.measure.up
        : rotateAbout(reference.measure.up, scale(axis, 1 / length(axis)), angle),
      face.normal
    )
    return { measure: measureCap(mesh, face, up), profile: first.profile }
  }
  if (reference !== undefined && !round(reference.measure.shape)) {
    const top = dot(reference.measure.topMiddle, reference.measure.up)
    const surface = surfaceFrom(
      mesh,
      reference.face,
      (p) => dot(p, reference.measure.up) >= top - 0.5,
      reference.measure.up
    )
    const reached = options.filter(({ measure }) => {
      const high = dot(measure.topMiddle, measure.up)
      return touches(mesh, face, surface, (p) => dot(p, measure.up) >= high - 0.5)
    })
    if (reached.length === 1) return reached[0]
  }
  const toMiddle = sub(mesh.centroid, nth(options, 0).measure.centre)
  const best = options.reduce((a, b) => (dot(b.measure.up, toMiddle) > dot(a.measure.up, toMiddle) ? b : a))
  return dot(best.measure.up, toMiddle) > 1 ? best : first
}

const endOf = ({ measure, profile }: Pick<Found, "measure" | "profile">): End => {
  const position = tuple(profile.anchor === "top" ? measure.topMiddle : measure.centre, cm)
  const forward = tuple(measure.forward, unit)
  const up = tuple(squareTo(measure.up, measure.forward), unit)
  const centre = tuple(measure.centre, cm)
  const offCentre = Math.hypot(...sub(centre, position)) > 0.005
  const { shape } = measure
  const cap: Cap = shape.shape === "circle"
    ? { shape: "circle", radius: cm(shape.radius) }
    : shape.shape === "annulus"
    ? { shape: "annulus", radius: cm(shape.radius), innerRadius: cm(shape.innerRadius) }
    : { shape: shape.shape, width: cm(shape.width), height: cm(shape.height) }
  return {
    position,
    forward,
    up,
    profile: profile.name,
    ...(profile.handed === true && { hand: measure.lean > 0 ? "right" as const : "left" as const }),
    cap: offCentre ? { ...cap, centre } : cap
  }
}

/** The ends of one piece's mesh, and the caps the survey found that no profile takes. */
export const surveyMesh = (
  mesh: Mesh,
  className: string
): { readonly ends: ReadonlyArray<End>; readonly unmatched: ReadonlyArray<Unmatched> } => {
  const along = ENDS_ALONG[className]
  const caps = capsOf(mesh).filter((face) => along === undefined || Math.abs(dot(face.normal, along)) > VERTICAL)
  const found: Array<Found> = []
  const vertical: Array<FlatFace> = []
  const unmatched: Array<Unmatched> = []
  const miss = (face: FlatFace, measure: CapMeasure) =>
    unmatched.push({
      forward: tuple(face.normal, unit),
      area: cm(face.area),
      width: cm(measure.width),
      height: cm(measure.height),
      centre: tuple(measure.centre, cm)
    })
  for (const face of caps) {
    if (Math.abs(face.normal[2]) > VERTICAL) {
      vertical.push(face)
      continue
    }
    const up = capUp(mesh, face, squareTo([0, 0, 1], face.normal))
    const [framing] = framings(mesh, face, up, [0])
    if (framing === undefined) miss(face, measureCap(mesh, face, up))
    else found.push({ face, ...framing })
  }
  const reference = found.find(({ measure }) => !round(measure.shape)) ?? found[0]
  for (const face of vertical) {
    const base = squareTo([1, 0, 0], face.normal)
    const up = capUp(mesh, face, base, QUARTER / 2)
    const chosen = verticalUp(mesh, face, framings(mesh, face, up, [0, 1, 2, 3]), reference)
    if (chosen === undefined) miss(face, measureCap(mesh, face, up))
    else found.push({ face, ...chosen })
  }
  return { ends: found.map(endOf), unmatched }
}

/** Ends in the order `previous` had them, so a joint's end numbers keep meaning the same end; new ones after. */
export const keepOrder = (ends: ReadonlyArray<End>, previous: ReadonlyArray<{ readonly position: Vec }>) => {
  const rank = (end: End) => {
    const at = previous.findIndex((old) => Math.hypot(...sub(old.position, end.position)) < 1)
    return at === -1 ? previous.length : at
  }
  const byPosition = (a: End, b: End) =>
    a.position[0] - b.position[0] || a.position[1] - b.position[1] || a.position[2] - b.position[2]
  return [...ends].sort((a, b) => rank(a) - rank(b) || byPosition(a, b))
}

const CatalogPieces = Schema.Struct({
  pieces: Schema.Array(Schema.Struct({
    className: Schema.String,
    category: Schema.optionalKey(Schema.NullOr(Schema.String)),
    inPalette: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    glb: Schema.optionalKey(Schema.NullOr(Schema.String))
  }))
})

/** The whole catalog as it is, every key in its place, to put the ends into as build-catalog.mjs does. */
const anyObject = Schema.Record(Schema.String, Schema.Unknown)
const CatalogPiecesOnly = Schema.Struct({ pieces: Schema.Array(anyObject) })

/** The pieces the survey reads, with their meshes' paths under the asset pack. */
export const surveyedPieces = (catalog: typeof CatalogPieces.Type) =>
  catalog.pieces.flatMap((piece) =>
    piece.inPalette === true && typeof piece.glb === "string" &&
      (SURVEYED_CATEGORIES.has(piece.category ?? "") || SURVEYED_PIECES.has(piece.className))
      ? [{ className: piece.className, glb: piece.glb }]
      : []
  )

export class SurveyError extends Schema.TaggedError<SurveyError>()("SurveyError", {
  message: Schema.String
}) {}

const fmt = (v: Vec) => v.map((n) => roundTo(2)(n)).join(", ")

/**
 * `extract connectors`: survey every piece, print each one's ends and the caps no profile took, and with `write` replace
 * connectors.json and the catalog's `connectors` (as build-catalog.mjs copies them, after `bounds`).
 */
export const connectorSurvey = Effect.fn("connectorSurvey")(
  function*({ meshes, write }: { readonly meshes: string; readonly write: boolean }) {
    const fs = yield* FileSystem
    const path = yield* Path
    const here = path.join(import.meta.dirname, "..")
    const catalogPath = path.join(here, "..", "..", "assets", "catalog.json")
    const connectorsPath = path.join(here, "connectors.json")
    const catalogText = yield* fs.readFileString(catalogPath)
    const catalog = yield* Schema.decodeEffect(Schema.fromJsonString(CatalogPieces))(catalogText)
    const previous = yield* Schema.decodeEffect(Schema.fromJsonString(ConnectorsFile))(
      yield* fs.readFileString(connectorsPath)
    )
    const pieces: Record<string, ReadonlyArray<End>> = {}
    for (const { className, glb } of surveyedPieces(catalog)) {
      const triangles = yield* Effect.tryPromise({
        try: () => loadTriangles(path.join(meshes, glb)),
        catch: (cause) => new SurveyError({ message: `${glb}: ${String(cause)}` })
      })
      const { ends, unmatched } = surveyMesh(meshOf(triangles), className)
      const ordered = keepOrder(ends, previous.pieces[className] ?? [])
      yield* Console.log(`${className}: ${ordered.length === 0 ? "no ends" : `${ordered.length} ends`}`)
      for (const end of ordered) {
        const hand = end.hand === undefined ? "" : ` ${end.hand}`
        yield* Console.log(`  ${end.profile}${hand} at ${fmt(end.position)} facing ${fmt(end.forward)}`)
      }
      // A piece with no ends lists the caps it does have, in case one is an end of a profile not in PROFILES yet.
      for (const cap of ordered.length === 0 ? unmatched.filter((c) => c.area >= 1000) : []) {
        yield* Console.log(
          `  no profile: ${cap.area} cm², ${cap.width} × ${cap.height} at ${fmt(cap.centre)} facing ${fmt(cap.forward)}`
        )
      }
      if (ordered.length > 0) pieces[className] = ordered
    }
    if (!write) return
    const file = {
      game: "0.4.1",
      measured: new Date().toISOString().slice(0, 10),
      method: "docs/qa/connectors.md",
      pieces
    }
    yield* fs.writeFileString(connectorsPath, JSON.stringify(file, null, 2) + "\n")
    const full = yield* Schema.decodeEffect(Schema.fromJsonString(anyObject))(catalogText)
    const { pieces: rawPieces } = yield* Schema.decodeUnknownEffect(CatalogPiecesOnly)(full)
    const withPieces = rawPieces.map((piece) => {
      const className = piece["className"]
      const ends = typeof className === "string" ? pieces[className] : undefined
      const { connectors: _, ...rest } = piece
      return Object.fromEntries(
        Object.entries(rest).flatMap(([key, value]) =>
          key === "bounds" && ends !== undefined ? [[key, value], ["connectors", ends]] : [[key, value]]
        )
      )
    })
    const withEnds = Object.fromEntries(
      Object.entries(full).map(([key, value]) => [key, key === "pieces" ? withPieces : value])
    )
    yield* fs.writeFileString(catalogPath, JSON.stringify(withEnds, null, 2) + "\n")
    yield* Console.log(`wrote ${Object.keys(pieces).length} pieces to connectors.json and the catalog`)
  }
)
