// What `pnpm map` works out, kept apart from the command line and the disk so tests can run it.
import { Schema } from "effect"
import type { CatalogIndex, CatalogPiece } from "../../../apps/web/src/domain/Catalog.ts"
import { itemFromPiece, newMapFile, placementTransform } from "../../../apps/web/src/domain/factory.ts"
import { DEFAULT_PLAYER_START } from "../../../apps/web/src/domain/level.ts"
import { LIMITS } from "../../../apps/web/src/domain/limits.ts"
import {
  classNameOf,
  GOAL_CLASS,
  isPlayerStart,
  type Item,
  type MapFile,
  PLAYER_START_CLASS
} from "../../../apps/web/src/domain/MapFile.ts"

/** A generated map's date, fixed so the same options write the same bytes. */
const BUILT_AT = "2026.01.01-00.00.00"
/** Room for the widest piece a build places, in UE centimetres. */
const CELL_MARGIN = 200
const TOP_PIECES = 10

interface PieceCount {
  readonly piece: string
  readonly count: number
}

interface Extent {
  readonly min: { readonly x: number; readonly y: number; readonly z: number }
  readonly max: { readonly x: number; readonly y: number; readonly z: number }
}

export interface MapSummary {
  readonly name: string
  readonly creator: string
  readonly difficulty: string
  readonly validated: boolean
  readonly items: number
  readonly groups: number
  readonly characters: number
  readonly characterLimit: number
  /** Where the items sit, in UE centimetres; none on a map without items. */
  readonly extent: Extent | null
  readonly topPieces: ReadonlyArray<PieceCount>
  /** Classes the catalog doesn't know. */
  readonly unknownPieces: ReadonlyArray<string>
}

const countsOf = (items: ReadonlyArray<Item>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()
  for (const item of items) {
    const piece = classNameOf(item.actorToSpawn)
    counts.set(piece, (counts.get(piece) ?? 0) + 1)
  }
  return counts
}

const extentOf = (items: ReadonlyArray<Item>): Extent | null => {
  const points = items.map((item) => item.itemTransform.translation)
  if (points.length === 0) return null
  const along = (axis: "x" | "y" | "z") => points.map((point) => point[axis])
  return {
    min: { x: Math.min(...along("x")), y: Math.min(...along("y")), z: Math.min(...along("z")) },
    max: { x: Math.max(...along("x")), y: Math.max(...along("y")), z: Math.max(...along("z")) }
  }
}

export const summaryOf = (map: MapFile, characters: number, catalog: CatalogIndex): MapSummary => {
  const level = map.worldSettings.levelData
  const counts = [...countsOf(map.items)].map(([piece, count]) => ({ piece, count }))
  const known = new Set([...catalog.pieceByClass.keys()].map(classNameOf))
  return {
    name: level.levelDisplayName,
    creator: level.creatorName,
    difficulty: level.levelDifficulty,
    validated: level.bValidated,
    items: map.items.length,
    groups: map.editorState?.groups.length ?? 0,
    characters,
    characterLimit: LIMITS.charactersPerFile,
    extent: extentOf(map.items),
    topPieces: counts.toSorted((a, b) => b.count - a.count || a.piece.localeCompare(b.piece)).slice(0, TOP_PIECES),
    unknownPieces: counts.map(({ piece }) => piece).filter((piece) => !known.has(piece)).toSorted()
  }
}

/** How many of each piece `after` has more (or fewer) than `before`, biggest change first. */
export const pieceChanges = (before: MapFile, after: MapFile): ReadonlyArray<PieceCount> => {
  const was = countsOf(before.items)
  const now = countsOf(after.items)
  return [...new Set([...was.keys(), ...now.keys()])]
    .map((piece) => ({ piece, count: (now.get(piece) ?? 0) - (was.get(piece) ?? 0) }))
    .filter(({ count }) => count !== 0)
    .toSorted((a, b) => Math.abs(b.count) - Math.abs(a.count) || a.piece.localeCompare(b.piece))
}

const Verified = Schema.Struct({ results: Schema.Record(Schema.String, Schema.Struct({ status: Schema.String })) })

/** `assets/verified.json`, as the pieces it records as loaded in the game. */
export const VerifiedPieces = Schema.fromJsonString(Verified)

export const loadedPieces = ({ results }: typeof Verified.Type): ReadonlySet<string> =>
  new Set(Object.entries(results).filter(([, { status }]) => status === "ok").map(([piece]) => piece))

/** Pieces a build may place: on the palette, loaded in the game (`assets/verified.json`), and not the map's two fixtures. */
export const buildablePieces = (
  pieces: ReadonlyArray<CatalogPiece>,
  verified: ReadonlySet<string>
): ReadonlyArray<CatalogPiece> =>
  pieces.filter((piece) =>
    piece.inPalette && piece.meshAssetPath !== null && verified.has(piece.className)
    && piece.classPath !== PLAYER_START_CLASS && piece.classPath !== GOAL_CLASS
  )

/** mulberry32: the same seed gives the same map, on any machine. */
const randomFrom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const widthOf = ({ bounds }: CatalogPiece): number =>
  bounds === null || bounds === undefined
    ? 0
    : Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1])

export interface BuildOptions {
  readonly name: string
  readonly creator: string
  /** Items besides the player start and the goal. */
  readonly items: number
  readonly seed: number
  readonly pieces: ReadonlyArray<CatalogPiece>
}

/** A map with `items` pieces picked by `seed`, on a square grid beside the player start, one piece to a cell. */
export const buildMap = ({ creator, items, name, pieces, seed }: BuildOptions): MapFile => {
  const { items: fixtures, ...settings } = newMapFile({ displayName: name, creatorName: creator, createdAt: BUILT_AT })
  const random = randomFrom(seed)
  const cell = Math.ceil(Math.max(0, ...pieces.map(widthOf))) + CELL_MARGIN
  const columns = Math.max(1, Math.ceil(Math.sqrt(items)))
  const start = fixtures.find(isPlayerStart)?.itemTransform.translation ?? DEFAULT_PLAYER_START
  const placed = Array.from({ length: items }, (_, index) => index).flatMap((index) => {
    const piece = pieces[Math.floor(random() * pieces.length)]
    if (piece === undefined) return []
    const translation = {
      x: start.x + cell * (1 + (index % columns)),
      y: start.y + cell * (Math.floor(index / columns) - columns / 2),
      z: start.z
    }
    return [itemFromPiece(piece, placementTransform(piece, translation))]
  })
  return { ...settings, items: [...fixtures, ...placed] }
}
