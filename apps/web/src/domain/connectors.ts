/**
 * The ends of placed pieces (docs/SNAPPING.md § Connectors): where each piece's measured ends stand in the world, what
 * it takes for two to meet, and which no other end meets. A piece with no measured ends has none here, and Mesh carries
 * it. Everything in game space.
 */
import type { CatalogIndex, Connector } from "./Catalog"
import { type ConnectAt, spotPosition } from "./connectorSpots"
import type { Quat4, UeTransform, Vec3 } from "./coords"
import type { Item } from "./MapFile"
import type { EndRef } from "./MapSidecar"
import { mirrorScaleOf } from "./mirror"
import { localToWorld } from "./pivot"
import {
  quatConjugate,
  quatFromFrame,
  quatMul,
  quatNormalize,
  rotateVec,
  vecDistance,
  vecDot,
  vecNormalize,
  vecScale,
  vecSub
} from "./ueMath"

/** One end of a placed piece. */
export interface WorldEnd {
  readonly ref: EndRef
  readonly position: Vec3
  /** The way it faces out of its piece, unit length. */
  readonly forward: Vec3
  readonly up: Vec3
  readonly profile: string
  readonly hand?: "left" | "right"
  /** Its cap's footprint in the world, when the piece's data has one: where it is centred, and how far it reaches. */
  readonly cap?: WorldCap
}

export interface WorldCap {
  readonly centre: Vec3
  /** The farthest the cap's outline gets from its centre, in cm, as the piece is scaled. */
  readonly reach: number
}

/** How far apart two ends can be and still meet, in cm. */
export const MEET_CM = 0.1

/** How nearly opposite two ends must face to meet, as the dot of their directions. */
const FACING = -0.999

const connectorsOf = (item: Item, index: CatalogIndex | null): ReadonlyArray<Connector> =>
  index?.pieceByClass.get(item.actorToSpawn)?.connectors ?? []

/**
 * An end's point and directions after an item's mirroring, the same flip as its geometry, with its point moved to the
 * spot `spot` names. The spot is placed after the flip, so its left stays the left looking out of the end.
 */
const mirrored = (
  connector: Connector,
  flip: readonly [number, number, number] | undefined,
  spot: ConnectAt[string] | undefined
) => {
  const [fx, fy, fz] = flip ?? [1, 1, 1]
  const by = ([x, y, z]: Connector["position"]): Connector["position"] => [x * fx, y * fy, z * fz]
  const { cap } = connector
  const flipped = {
    position: by(connector.position),
    forward: by(connector.forward),
    up: by(connector.up),
    ...(cap !== undefined && { cap: cap.centre === undefined ? cap : { ...cap, centre: by(cap.centre) } })
  }
  const vec = ([x, y, z]: Connector["position"]): Vec3 => ({ x, y, z })
  return {
    position: vec(spotPosition(flipped, spot)),
    forward: vec(flipped.forward),
    up: vec(flipped.up),
    ...(flipped.cap !== undefined && {
      cap: {
        centre: vec(flipped.cap.centre ?? flipped.position),
        reach: flipped.cap.shape === "circle" || flipped.cap.shape === "annulus"
          ? flipped.cap.radius
          : Math.hypot(flipped.cap.width / 2, flipped.cap.height / 2)
      }
    })
  }
}

/** A cap's footprint under `transform`: its centre placed, its reach stretched by the largest scale. */
const worldCap = (transform: UeTransform, cap: { readonly centre: Vec3; readonly reach: number }): WorldCap => {
  const { x, y, z } = transform.scale3D
  return {
    centre: localToWorld(transform, cap.centre),
    reach: cap.reach * Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
  }
}

/** What flipping does to a lopsided end: one mirror swaps its sides, two put them back. */
const handAfter = (hand: Connector["hand"], flip: readonly [number, number, number] | undefined) => {
  if (hand === undefined) return undefined
  const swapped = flip !== undefined && flip[0] * flip[1] * flip[2] < 0
  return swapped ? hand === "left" ? "right" : "left" : hand
}

/** How far below this a scale counts as none, which has no inverse: the end keeps its sign alone along that axis. */
const FLAT_SCALE = 1e-9

/**
 * An end's directions under `transform`, as its cap stands in the world. The cap's points go through the scale, so a
 * direction along the cap does too, and `up` is one. `forward` is the cap's normal, which a scale unlike on every axis
 * would skew if it went through as a direction: it takes the scale's inverse instead, and so stays square to the cap.
 */
const worldFrame = (transform: UeTransform, forward: Vec3, up: Vec3): { readonly forward: Vec3; readonly up: Vec3 } => {
  const { x, y, z } = transform.scale3D
  const inverse = (s: number) => Math.abs(s) < FLAT_SCALE ? (s < 0 ? -1 : 1) : 1 / s
  const normal = vecNormalize(
    rotateVec(transform.rotation, { x: forward.x * inverse(x), y: forward.y * inverse(y), z: forward.z * inverse(z) })
  )
  const along = rotateVec(transform.rotation, { x: up.x * x, y: up.y * y, z: up.z * z })
  return { forward: normal, up: vecNormalize(vecSub(along, vecScale(normal, vecDot(along, normal)))) }
}

/** The ends of `item` (of stable key `key`) under `transform`, each at the spot `connectAt` chooses for it, if any. */
export const endsOf = (
  key: string,
  item: Item,
  transform: UeTransform,
  index: CatalogIndex | null,
  connectAt?: ConnectAt
): ReadonlyArray<WorldEnd> => {
  const connectors = connectorsOf(item, index)
  if (connectors.length === 0) return []
  const flip = mirrorScaleOf(item, index)
  return connectors.map((connector, end) => {
    const { cap, forward, position, up } = mirrored(connector, flip, connectAt?.[String(end)])
    const hand = handAfter(connector.hand, flip)
    return {
      ref: { item: key, end },
      position: localToWorld(transform, position),
      ...worldFrame(transform, forward, up),
      profile: connector.profile,
      ...(hand !== undefined && { hand }),
      ...(cap !== undefined && { cap: worldCap(transform, cap) })
    }
  })
}

/** The turn that makes `own` face `other`, up matching up. */
export const meetingTurn = (own: WorldEnd, other: WorldEnd): Quat4 =>
  quatNormalize(
    quatMul(quatFromFrame(vecScale(other.forward, -1), other.up), quatConjugate(quatFromFrame(own.forward, own.up)))
  )

/** Whether two ends of different items stand on each other, facing opposite ways. */
export const endsMeet = (a: WorldEnd, b: WorldEnd): boolean =>
  a.ref.item !== b.ref.item && vecDistance(a.position, b.position) <= MEET_CM && vecDot(a.forward, b.forward) <= FACING

/** Whether two ends take each other: the same cross-section, and for a lopsided one the sides that fill it. */
export const endsFit = (
  a: WorldEnd,
  b: WorldEnd
): { readonly profile: boolean; readonly hand: boolean } => ({
  profile: a.profile === b.profile,
  hand: a.hand === undefined || b.hand === undefined || a.hand !== b.hand
})

/** A cell a little wider than `MEET_CM`: two ends that meet are in one cell or two next to each other. */
const CELL_CM = 1

const cellKey = ({ x, y, z }: Vec3, dx = 0, dy = 0, dz = 0) =>
  `${Math.floor(x / CELL_CM) + dx},${Math.floor(y / CELL_CM) + dy},${Math.floor(z / CELL_CM) + dz}`

const NEAR = [-1, 0, 1]

/** The ends no other end meets: "where does the track still need a piece". */
export const openEndsOf = (ends: ReadonlyArray<WorldEnd>): ReadonlyArray<WorldEnd> => {
  const cells = new Map<string, Array<WorldEnd>>()
  for (const end of ends) {
    const key = cellKey(end.position)
    const cell = cells.get(key)
    if (cell === undefined) cells.set(key, [end])
    else cell.push(end)
  }
  return ends.filter((end) =>
    !NEAR.some((dx) =>
      NEAR.some((dy) =>
        NEAR.some((dz) => cells.get(cellKey(end.position, dx, dy, dz))?.some((other) => endsMeet(end, other)) === true)
      )
    )
  )
}
