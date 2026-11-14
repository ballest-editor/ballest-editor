/**
 * The plate mesh search: local edits to a low-poly mesh (slide a vertex, split, collapse or flip an edge), each kept
 * only when the pieces made from the edited mesh score better. Where to edit is chosen by a cheap stand-in, how far
 * the source's surface samples lie from the mesh; whether an edit stays is the caller's `evaluate`, which scores the
 * real pieces. The search stops when its time is up, reading the clock (clock.ts) at fixed points.
 */
import type { Vec3 } from "../../coords"
import { vecAdd, vecDot, vecLength, vecNormalize, vecScale, vecSub } from "../../ueMath"
import { now } from "../clock"
import { faceCount, type Mesh } from "../mesh/mesh"
import { meshFace, meshNormal, meshVertex } from "../mesh/plateMesh"
import type { PlateSource } from "../mesh/remesh"
import { Surface } from "../mesh/surface"
import type { Plane } from "../parts/symmetry"
import { byPartners, isMirrored, mirrorPoint, ontoPlane, type Paired, partnersOf, signedDistance } from "./plateMirror"

/** A transfer is a collapse and a split together: a face pair moved from where it is cheap to where it is needed. */
type MeshMove = "slide" | "flip" | "collapse" | "split" | "transfer"

export interface SearchStats {
  readonly seconds: number
  /** Edits that could be made and were scored. */
  readonly tried: number
  readonly accepted: Readonly<Record<MeshMove, number>>
  /** The score of the mesh the search started from, and of the one it ended on. */
  readonly before: number
  readonly after: number
  readonly moved: ReadonlyArray<{ readonly move: MeshMove; readonly from: Vec3; readonly to: Vec3 }>
}

/** An edge with a face on each side: its ends as the first face runs them, the two faces and their third corners. */
interface Edge {
  readonly a: number
  readonly b: number
  readonly faces: ReadonlyArray<number>
  readonly opposite: ReadonlyArray<number>
}

/** The search gives up after this many rounds, whatever time is left. */
const ROUNDS = 200
/** Every fourth of the source's samples is measured each round. */
const SAMPLE_STEP = 4
/** A round works on one of this many worst samples, and one of this many cheapest edges, by turns. */
const WORST = 12
const CHEAPEST = 12
/** How far a slide pulls its vertex, and a split its new vertex, towards the worst sample, as a share of the error. */
const SLIDE_PULL = 0.65
const SPLIT_PULL = 0.8
/** An edit must raise the score by more than this. */
const GAIN = 1e-6
/** An edit is refused when a face it changes keeps under this share of its normal along the old one. */
const SLIDE_TURN = 0.1
const SPLIT_TURN = 0.05
const COLLAPSE_TURN = 0.1

/** The edges of `mesh` with exactly two faces, in the order the faces first run them. */
export const meshEdges = (mesh: Mesh): Array<Edge> => {
  const edges = new Map<string, { a: number; b: number; faces: Array<number>; opposite: Array<number> }>()
  for (let f = 0; f < faceCount(mesh); f++) {
    const ids = meshFace(mesh, f)
    for (let k = 0; k < 3; k++) {
      const a = ids[k] ?? 0, b = ids[(k + 1) % 3] ?? 0, c = ids[(k + 2) % 3] ?? 0
      const key = `${Math.min(a, b)},${Math.max(a, b)}`
      const edge = edges.get(key) ?? { a, b, faces: [], opposite: [] }
      edge.faces.push(f)
      edge.opposite.push(c)
      edges.set(key, edge)
    }
  }
  return [...edges.values()].filter((edge) => edge.faces.length === 2)
}

const joins = (edge: Edge, a: number, b: number): boolean =>
  edge.a === a && edge.b === b || edge.a === b && edge.b === a

/** The edge between `a` and `b`, read from `a`, if the mesh has one with a face on each side. */
const edgeOf = (mesh: Mesh, a: number, b: number): Edge | undefined => {
  const found = meshEdges(mesh).find((edge) => joins(edge, a, b))
  return found === undefined || found.a === a ? found : { ...found, a, b }
}

/** Whether the edge between `edge`'s opposite corners exists already, so turning `edge` would double it. */
const hasOpposite = (edges: ReadonlyArray<Edge>, edge: Edge): boolean =>
  edges.some((other) => joins(other, edge.opposite[0] ?? 0, edge.opposite[1] ?? 0))

/** Whether the face `ids` of `mesh` keeps at least `share` of the normal `before` along it. */
const keepsFacing = (mesh: Mesh, ids: ReadonlyArray<number>, before: Vec3, share: number): boolean =>
  !(vecDot(meshNormal(mesh, ids), before) < share * vecDot(before, before))

/** `mesh` with vertex `i` at `p`, unless that turns a face round it over. */
const slidVertex = (mesh: Mesh, i: number, p: Vec3): Mesh | undefined => {
  const positions = mesh.positions.slice()
  positions.set([p.x, p.y, p.z], i * 3)
  const next = { positions, indices: mesh.indices.slice() }
  for (let f = 0; f < faceCount(mesh); f++) {
    const ids = meshFace(mesh, f)
    if (ids.includes(i) && !keepsFacing(next, ids, meshNormal(mesh, ids), SLIDE_TURN)) return undefined
  }
  return next
}

/**
 * `edge` split at a new vertex at `p`, its two faces becoming four, so the mesh stays closed. Put on the source's
 * surface, the new vertex can follow a thin feature the decimation lost. Undefined when a new face turns over.
 */
export const splitMeshEdge = (mesh: Mesh, edge: Edge, p: Vec3): Mesh | undefined => {
  const added = mesh.positions.length / 3
  const positions = new Float32Array(mesh.positions.length + 3)
  positions.set(mesh.positions)
  positions.set([p.x, p.y, p.z], added * 3)
  const moved = { positions, indices: mesh.indices }
  const indices: Array<number> = []
  for (let f = 0; f < faceCount(mesh); f++) {
    const ids = meshFace(mesh, f)
    if (!edge.faces.includes(f)) {
      indices.push(...ids)
      continue
    }
    const k = ids.findIndex((v, j) => joins(edge, v, ids[(j + 1) % 3] ?? -1))
    if (k < 0) return undefined
    const a = ids[k] ?? 0, b = ids[(k + 1) % 3] ?? 0, c = ids[(k + 2) % 3] ?? 0
    const halves = [[a, added, c], [added, b, c]], before = meshNormal(mesh, ids)
    if (!halves.every((half) => keepsFacing(moved, half, before, SPLIT_TURN))) return undefined
    indices.push(...halves.flat())
  }
  return { positions, indices: new Uint32Array(indices) }
}

/**
 * `edge` collapsed into its end `a`, moved to `p`. Undefined unless its ends have exactly two neighbours in common
 * (the link condition, which keeps the mesh closed) and no face round them folds over.
 */
export const collapseMeshEdge = (mesh: Mesh, edge: Edge, p: Vec3): Mesh | undefined => {
  const edges = meshEdges(mesh)
  const neighbours = (i: number) => new Set(edges.flatMap((e) => e.a === i ? [e.b] : e.b === i ? [e.a] : []))
  const beside = neighbours(edge.b)
  if ([...neighbours(edge.a)].filter((i) => beside.has(i)).length !== 2) return undefined
  const positions = mesh.positions.slice()
  positions.set([p.x, p.y, p.z], edge.a * 3)
  const moved = { positions, indices: mesh.indices }
  const indices: Array<number> = []
  for (let f = 0; f < faceCount(mesh); f++) {
    if (edge.faces.includes(f)) continue
    const old = meshFace(mesh, f), ids = old.map((i) => i === edge.b ? edge.a : i)
    if (new Set(ids).size !== 3) return undefined
    const changed = old.includes(edge.a) || old.includes(edge.b)
    if (changed && !keepsFacing(moved, ids, meshNormal(mesh, old), COLLAPSE_TURN)) return undefined
    indices.push(...ids)
  }
  return { positions, indices: new Uint32Array(indices) }
}

/** `edge` turned to join its opposite corners, unless that turns either face over. */
const flipMeshEdge = (mesh: Mesh, edge: Edge): Mesh | undefined => {
  const a = edge.opposite[0] ?? 0, b = edge.opposite[1] ?? 0, f = edge.faces[0] ?? 0, g = edge.faces[1] ?? 0
  const first = meshFace(mesh, f), second = meshFace(mesh, g)
  const along = first[(first.indexOf(edge.a) + 1) % 3] === edge.b
  const turned = along ? [a, b, edge.b] : [a, edge.b, b], other = along ? [b, a, edge.a] : [b, edge.a, a]
  if (
    vecDot(meshNormal(mesh, turned), meshNormal(mesh, first)) <= 0 ||
    vecDot(meshNormal(mesh, other), meshNormal(mesh, second)) <= 0
  ) return undefined
  const indices = mesh.indices.slice()
  indices.set(turned, f * 3)
  indices.set(other, g * 3)
  return { positions: mesh.positions.slice(), indices }
}

/** One local edit, by vertex indices: a collapse keeps `a`. */
type Edit =
  | { readonly kind: "slide"; readonly vertex: number; readonly to: Vec3 }
  | { readonly kind: "split" | "collapse"; readonly a: number; readonly b: number; readonly to: Vec3 }
  | { readonly kind: "flip"; readonly a: number; readonly b: number }

type EdgeEdit = Exclude<Edit, { readonly kind: "slide" }>

const editedMesh = (mesh: Mesh, edit: Edit): Mesh | undefined => {
  if (edit.kind === "slide") return slidVertex(mesh, edit.vertex, edit.to)
  const edge = edgeOf(mesh, edit.a, edit.b)
  if (edge === undefined) return undefined
  if (edit.kind === "split") return splitMeshEdge(mesh, edge, edit.to)
  if (edit.kind === "collapse") return collapseMeshEdge(mesh, edge, edit.to)
  return hasOpposite(meshEdges(mesh), edge) ? undefined : flipMeshEdge(mesh, edge)
}

/** `edit` made on `state`. A split's new vertex gets `partner` as its mirror partner, or itself. */
const edited = (state: Paired, edit: Edit, partner?: number): Paired | undefined => {
  const mesh = editedMesh(state.mesh, edit)
  if (mesh === undefined) return undefined
  if (edit.kind !== "split") return { mesh, partners: state.partners }
  const added = state.partners.length
  const partners = new Int32Array(added + 1)
  partners.set(state.partners)
  partners[added] = partner ?? added
  return { mesh, partners }
}

/** `edits` made one after another; undefined when one can't be made. */
const editedBy = (start: Paired, edits: ReadonlyArray<Edit>): Paired | undefined =>
  edits.reduce((state: Paired | undefined, edit) => state === undefined ? undefined : edited(state, edit), start)

/** A slide and its mirror image; a vertex on the plane slides once, along the plane. */
const mirroredSlide = (state: Paired, edit: Edit & { readonly kind: "slide" }, plane: Plane): Paired | undefined => {
  const image = state.partners[edit.vertex] ?? -1
  if (image < 0) return undefined
  if (image === edit.vertex) return edited(state, { ...edit, to: ontoPlane(plane, edit.to) })
  return editedBy(state, [edit, { ...edit, vertex: image, to: mirrorPoint(edit.to, plane) }])
}

/**
 * An edge edit and its mirror image. An edge that is its own image (one in the plane, or across it) is edited once,
 * its point on the plane. A collapse keeps the end on the plane, so that its image collapses into the same vertex.
 */
const mirroredEdgeEdit = (state: Paired, edit: EdgeEdit, plane: Plane): Paired | undefined => {
  const image = (i: number) => state.partners[i] ?? -1
  const swapped = edit.kind === "collapse" && image(edit.b) === edit.b && image(edit.a) !== edit.a
  const a = swapped ? edit.b : edit.a, b = swapped ? edit.a : edit.b
  const ma = image(a), mb = image(b)
  if (ma < 0 || mb < 0) return undefined
  const itself = (ma === a && mb === b) || (ma === b && mb === a)
  if (edit.kind === "flip") return editedBy(state, itself ? [edit] : [edit, { ...edit, a: ma, b: mb }])
  const to = itself || (edit.kind === "collapse" && ma === a) ? ontoPlane(plane, edit.to) : edit.to
  const own = { ...edit, a, b, to }, mirror = { ...edit, a: ma, b: mb, to: mirrorPoint(to, plane) }
  if (itself) {
    const once = edited(state, own)
    if (once === undefined || edit.kind !== "collapse" || ma !== b) return once
    // A crossing edge collapsed puts its kept end on the plane.
    const partners = once.partners.slice()
    partners[a] = a
    return { mesh: once.mesh, partners }
  }
  if (edit.kind === "collapse") return editedBy(state, [own, mirror])
  // The two new vertices of a split and its image are each other's partners.
  const added = state.partners.length
  const once = edited(state, own, added + 1)
  return once === undefined ? undefined : edited(once, mirror, added)
}

/**
 * `edits` made on a mirror-symmetric mesh together with their mirror images, so it stays symmetric. Undefined when an
 * edit or its image can't be made, or the result isn't symmetric.
 */
const mirroredBy = (start: Paired, edits: ReadonlyArray<Edit>, plane: Plane): Paired | undefined => {
  let state = start
  for (const edit of edits) {
    const next = edit.kind === "slide" ? mirroredSlide(state, edit, plane) : mirroredEdgeEdit(state, edit, plane)
    if (next === undefined) return undefined
    state = next
  }
  if (!isMirrored(state.mesh, state.partners)) return undefined
  return { mesh: byPartners(state.mesh, plane, state.partners), partners: state.partners }
}

/** An edit the search may try: what to do, and where it moves the mesh from and to, for the statistics. */
interface Candidate {
  readonly move: MeshMove
  readonly from: Vec3
  readonly to: Vec3
  readonly edits: ReadonlyArray<Edit>
}

/** What collapsing an edge would cost, and how long it is against the length its place allows. */
interface EdgeCost {
  readonly cost: number
  readonly stretch: number
}

const middleOf = (mesh: Mesh, edge: Edge): Vec3 =>
  vecScale(vecAdd(meshVertex(mesh, edge.a), meshVertex(mesh, edge.b)), 0.5)

/**
 * The cost of each edge, in order, or undefined from the edge at which time ran out (the clock is read once an edge).
 * A long edge over a thin section is expensive, and one that bends the surface; a thick flat part is cheap to collapse.
 */
const edgeCosts = (
  mesh: Mesh,
  edges: ReadonlyArray<Edge>,
  source: PlateSource,
  deadline: number
): Array<EdgeCost | undefined> => {
  const meanLength =
    edges.reduce((sum, e) => sum + vecLength(vecSub(meshVertex(mesh, e.a), meshVertex(mesh, e.b))), 0) /
    Math.max(1, edges.length)
  return edges.map((edge) => {
    if (now() >= deadline) return undefined
    const a = meshVertex(mesh, edge.a), b = meshVertex(mesh, edge.b), middle = vecScale(vecAdd(a, b), 0.5)
    const first = edge.faces[0] ?? 0, n = vecNormalize(meshNormal(mesh, meshFace(mesh, first)))
    const thickness = Math.max(source.solid.thickness(middle, n), source.solid.thickness(middle, vecScale(n, -1)))
    const bend = 1 - vecDot(n, vecNormalize(meshNormal(mesh, meshFace(mesh, edge.faces[1] ?? first))))
    const length = vecLength(vecSub(a, b)), target = Math.min(meanLength, 1.1 * thickness)
    return { cost: length * (0.1 + bend) * Math.max(1, length / target), stretch: length / target }
  })
}

/** `edge` collapsed to the source's surface nearest its middle. */
const collapseOf = (mesh: Mesh, edge: Edge, onSource: (p: Vec3) => Vec3): Candidate => {
  const middle = middleOf(mesh, edge), to = onSource(middle)
  return { move: "collapse", from: middle, to, edits: [{ kind: "collapse", a: edge.a, b: edge.b, to }] }
}

/**
 * One round's candidates, in the order they are tried: a slide of a corner of the face nearest one of the worst
 * samples towards it, a split of an edge of that face (every third round, of the most stretched edge instead), that
 * split paid for by collapsing a cheap edge elsewhere, a flip of the split's edge, and the cheap edge's collapse alone.
 * Undefined when there is no sample to work on.
 */
const candidatesOf = (
  mesh: Mesh,
  source: PlateSource,
  round: number,
  deadline: number,
  mirrored: Plane | undefined
): Array<Candidate> | undefined => {
  const surface = new Surface(mesh)
  // The samples farthest from the mesh, which protect small features though their area is small. A mirrored search
  // proposes edits on one side only: each is made with its image.
  const errors = source.samples
    .filter((p, i) => i % SAMPLE_STEP === 0 && (mirrored === undefined || signedDistance(mirrored, p) >= 0))
    .map((p) => ({ p, hit: surface.nearest(p) }))
    .sort((a, b) => b.hit.squared - a.hit.squared)
  const edges = meshEdges(mesh)
  const costs = edgeCosts(mesh, edges, source, deadline)
  const costed = edges.map((edge, i) => ({ edge, cost: costs[i] }))
  const cheapest = [...costed].sort((a, b) => (a.cost?.cost ?? Infinity) - (b.cost?.cost ?? Infinity)).slice(
    0,
    CHEAPEST
  )
  const stretched = costed.flatMap(({ cost, edge }) => cost === undefined ? [] : [{ edge, stretch: cost.stretch }])
    .sort((a, b) => b.stretch - a.stretch)[0]?.edge
  const worst = errors[round % Math.min(WORST, errors.length)]
  if (worst === undefined) return undefined
  const error = vecSub(worst.p, worst.hit.point)
  const onSource = (p: Vec3) => source.surface.nearest(p).point
  const candidates: Array<Candidate> = []

  const vertex = meshFace(mesh, worst.hit.face)[round % 3] ?? 0, from = meshVertex(mesh, vertex)
  const pull = onSource(vecAdd(from, vecScale(error, SLIDE_PULL)))
  candidates.push({ move: "slide", from, to: pull, edits: [{ kind: "slide", vertex, to: pull }] })

  const cheap = cheapest[round % Math.max(1, cheapest.length)]?.edge
  const collapse = cheap === undefined ? undefined : collapseOf(mesh, cheap, onSource)

  const faceEdges = edges.filter((e) => e.faces.includes(worst.hit.face))
  const relieve = round % 3 === 2 && stretched !== undefined
  const edge = relieve ? stretched : faceEdges[round % Math.max(1, faceEdges.length)]
  if (edge !== undefined) {
    const middle = middleOf(mesh, edge)
    const target = onSource(relieve ? middle : vecAdd(middle, vecScale(error, SPLIT_PULL)))
    const split: Edit = { kind: "split", a: edge.a, b: edge.b, to: target }
    candidates.push({ move: "split", from: middle, to: target, edits: [split] })
    const around = new Set([edge.a, edge.b, ...edge.opposite])
    if (cheap !== undefined && collapse !== undefined && !around.has(cheap.a) && !around.has(cheap.b)) {
      candidates.push({ move: "transfer", from: collapse.to, to: target, edits: [...collapse.edits, split] })
    }
    if (!hasOpposite(edges, edge)) {
      candidates.push({ move: "flip", from: middle, to: target, edits: [{ kind: "flip", a: edge.a, b: edge.b }] })
    }
  }
  if (collapse !== undefined) candidates.push(collapse)
  return candidates
}

/**
 * The best of `initial` and the meshes local edits make of it within `seconds`, by `evaluate`, which gives a mesh's
 * score and whatever the caller keeps of it, or undefined for a mesh it can't use. With `mirror`, and a mesh that is
 * mirror-symmetric in it, every edit is made with its mirror image; otherwise the search is free. Undefined when
 * `initial` itself can't be used.
 */
export const searchPlateMesh = <T>(
  initial: Mesh,
  source: PlateSource,
  seconds: number,
  evaluate: (mesh: Mesh) => { readonly score: number; readonly result: T } | undefined,
  mirror?: Plane
): { readonly result: T; readonly stats: SearchStats } | undefined => {
  const first = evaluate(initial)
  if (first === undefined) return undefined
  let best = first, tried = 0
  let state: Paired = { mesh: initial, partners: mirror === undefined ? new Int32Array() : partnersOf(initial, mirror) }
  const mirrored = mirror !== undefined && isMirrored(initial, state.partners) ? mirror : undefined
  const accepted: Record<MeshMove, number> = { slide: 0, flip: 0, collapse: 0, split: 0, transfer: 0 }
  const moved: Array<{ move: MeshMove; from: Vec3; to: Vec3 }> = []
  const start = now(), deadline = start + Math.max(0, seconds) * 1000
  let round = 0
  while (now() < deadline && round < ROUNDS) {
    const candidates = candidatesOf(state.mesh, source, round, deadline, mirrored)
    if (candidates === undefined) break
    let improved = false
    for (const { edits, from, move, to } of candidates) {
      if (now() >= deadline) break
      const next = mirrored === undefined ? editedBy(state, edits) : mirroredBy(state, edits, mirrored)
      if (next === undefined) continue
      tried++
      const scored = evaluate(next.mesh)
      if (scored === undefined || scored.score <= best.score + GAIN) continue
      best = scored
      state = next
      accepted[move]++
      moved.push({ move, from, to })
      improved = true
      break
    }
    // After an accepted edit the same places are looked at again; otherwise the next sample and edge.
    round = improved ? Math.max(0, round - 1) : round + 1
  }
  return {
    result: best.result,
    stats: { seconds: (now() - start) / 1000, tried, accepted, before: first.score, after: best.score, moved }
  }
}
