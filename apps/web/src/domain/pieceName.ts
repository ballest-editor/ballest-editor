/**
 * What a piece is called in the UI. The game's names are codes with spaces in them ("Bevel_C Hump S"), and classes
 * outside the in-game browser have only a class name, so both are read into words here. The name is derived on every
 * call: `assets/catalog.json` keeps the game's own text, which search and the extractor still need.
 */
import type { CatalogPiece } from "./Catalog"

export type PieceSize = "S" | "M" | "L"

export interface PieceName {
  /** The piece in words, without its size: "Curve 1", "Bevel Corner Hump Shallow". */
  readonly name: string
  /** The size the game's name gives it, for a tag beside the name; undefined when it gives none. */
  readonly size: PieceSize | undefined
}

/** What tells a piece from the others in its palette section that read the same (`withOrdinals`). */
export interface Ordinal {
  readonly ordinal?: number
}

type Named = Pick<CatalogPiece, "className" | "displayName"> & Ordinal

const SIZE_WORDS: Readonly<Record<PieceSize, string>> = { S: "Small", M: "Medium", L: "Large" }

const SIZE_RANKS: Readonly<Record<PieceSize, number>> = { S: 0, M: 1, L: 2 }

const SIZES: Readonly<Record<string, PieceSize>> = {
  S: "S",
  M: "M",
  L: "L",
  Small: "S",
  Medium: "M",
  Large: "L"
}

/** The letter after `Bevel_`: a family of the bevel set, or for P and S just the category the piece is listed under. */
const BEVEL_FAMILIES: Readonly<Record<string, string>> = {
  C: "Corner",
  F: "Full",
  H: "Half",
  P: "",
  S: "",
  T: "Tall",
  TC: "Tall Corner"
}

/** A class ending in a hand: `Bevel_Full_ShortUScoop_L`, `Bevel_Half_SSurveL`. */
const HANDED_CLASS = /[_a-z][LR]$/

/**
 * A lone letter that isn't a size, with what the class must say for that reading to hold. Without this, "S" on a bevel
 * reads Small where the class says Shallow, and "L" on a side ramp reads Large where it is the left one. The hand comes
 * from the game's name, not the class: the game's left side ramp is the class ending in `_R`.
 */
const LETTERS: ReadonlyArray<readonly [letter: string, word: string, evidence: RegExp]> = [
  ["D", "Deep", /Deep/],
  ["D", "Steep", /Steep/],
  ["F", "Full", /Tube/],
  ["H", "Half", /Half/],
  ["L", "Left", HANDED_CLASS],
  ["Q", "Quarter", /Quarter/],
  ["R", "Right", HANDED_CLASS],
  ["S", "Shallow", /Shallow/]
]

/** Parts of a class name that say nothing to a person: prefixes, material markers and the engine's default material. */
const CLASS_NOISE = new Set(["AJ", "BP", "M", "MI", "MP", "SM", "WorldGridMaterial"])

/** The hash the engine gives a merged mesh. */
const HASH = /^[0-9A-F]{8}$/

/** Splits on underscores, spaces, case changes and the start of a number; a letter keeps its number ("S1"). */
const wordsOf = (text: string): ReadonlyArray<string> =>
  text
    .replace(/_+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z]{2,})(\d)/g, "$1 $2")
    .split(/\s+/)
    .filter((word) => word.length > 0)

const titleCased = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

const expanded = (word: string, className: string): ReadonlyArray<string> => {
  const [, letter, number] = /^([A-Z])(\d?)$/.exec(word) ?? []
  const found = LETTERS.find(([key, , evidence]) => key === letter && evidence.test(className))
  if (found === undefined) return [word]
  return number === undefined || number === "" ? [found[1]] : [found[1], number]
}

const fromGameName = (displayName: string, className: string): PieceName => {
  const text = displayName.replace(
    /^Bevel_([A-Z]+)/,
    (whole, code: string) => {
      const family = BEVEL_FAMILIES[code]
      return family === undefined ? whole : `Bevel ${family}`
    }
  )
  const words = wordsOf(text).flatMap((word) => expanded(word, className)).map(titleCased)
  const first = words[0]
  const last = words.at(-1)
  // "M Full Bowl": the size leads, and only the class tells it from any other M.
  if (words.length > 1 && first === "M" && className.includes("Medium")) {
    return { name: words.slice(1).join(" "), size: "M" }
  }
  const size = last === undefined ? undefined : SIZES[last]
  return words.length > 1 && size !== undefined
    ? { name: words.slice(0, -1).join(" "), size }
    : { name: words.join(" "), size: undefined }
}

const fromClassName = (className: string): PieceName => {
  const parts = className.split("_").filter((part) => !CLASS_NOISE.has(part) && !HASH.test(part))
  const words = [...new Set(parts)].flatMap(wordsOf).map(titleCased)
  return { name: words.join(" ") || className, size: undefined }
}

/**
 * A piece's name in words and its size, for anywhere a piece is named: "Bevel_C Hump S" is "Bevel Corner Hump Shallow"
 * with no size, and "Curve1 S" is "Curve 1" sized S. Pure and deterministic; pass `{ className }` for a class the catalog
 * doesn't know. Show the size as a tag beside the name, or use `pieceLabelOf` where there is room for one string only.
 * The class name stays out of the name: show it in a tooltip. A piece's ordinal ends the name, before the size.
 */
export const pieceDisplayName = (piece: Named): PieceName => {
  const read = piece.displayName ? fromGameName(piece.displayName, piece.className) : fromClassName(piece.className)
  return piece.ordinal === undefined ? read : { ...read, name: `${read.name} ${piece.ordinal}` }
}

const joined = (piece: Named, separator: string): string => {
  const { name, size } = pieceDisplayName(piece)
  return size === undefined ? name : `${name}${separator}${SIZE_WORDS[size]}`
}

/** The name as one string, the size written out ("Curve 1 Small"), for lists with no room for a tag. */
export const pieceLabelOf = (piece: Named): string => joined(piece, " ")

/** The name with the size set apart ("Curve 1 · Medium"), for a tooltip's first line. */
export const pieceTitleOf = (piece: Named): string => joined(piece, " · ")

/**
 * Each family of sizes together where its first piece stands, smallest first: the game's own order has Curve 2 as M, S,
 * L and Track as S, L with M further on. A family is the pieces sharing a name; a piece with no size stays where it is.
 */
export const inSizeOrder = <P extends Named>(pieces: ReadonlyArray<P>): ReadonlyArray<P> => {
  const families = new Map<string, Array<{ readonly piece: P; readonly size: PieceSize }>>()
  for (const piece of pieces) {
    const { name, size } = pieceDisplayName(piece)
    if (size !== undefined) families.set(name, [...families.get(name) ?? [], { piece, size }])
  }
  const placed = new Set<string>()
  return pieces.flatMap((piece) => {
    const { name, size } = pieceDisplayName(piece)
    if (size === undefined) return [piece]
    if (placed.has(name)) return []
    placed.add(name)
    return (families.get(name) ?? [])
      .toSorted((a, b) => SIZE_RANKS[a.size] - SIZE_RANKS[b.size])
      .map((member) => member.piece)
  })
}

/** How much less of a thumbnail's frame each size down from the family's largest fills. */
const SIZE_SCALE_STEP = 0.2

/**
 * How much of a thumbnail's frame each piece fills, so one shape's sizes differ at a glance: the family's largest fills it
 * all, and each size below takes 20% off, so S, M and L are 60%, 80% and 100%. A family is the pieces sharing a name, as in
 * `inSizeOrder`; a piece with no size fills the frame.
 */
export const sizeScalesOf = <P extends Named>(pieces: ReadonlyArray<P>): ReadonlyMap<P, number> => {
  const largest = new Map<string, number>()
  for (const piece of pieces) {
    const { name, size } = pieceDisplayName(piece)
    if (size !== undefined) largest.set(name, Math.max(largest.get(name) ?? 0, SIZE_RANKS[size]))
  }
  return new Map(pieces.map((piece) => {
    const { name, size } = pieceDisplayName(piece)
    const steps = size === undefined ? 0 : (largest.get(name) ?? 0) - SIZE_RANKS[size]
    return [piece, 1 - SIZE_SCALE_STEP * steps]
  }))
}

/**
 * Numbers the pieces in a list that read the same: classes the game doesn't name differ only by the hash the name drops,
 * so seven read "Boolean Arena White". The first keeps the plain name, and the rest count from 2, past any number
 * another piece's name already has.
 */
export const withOrdinals = <P extends Named>(pieces: ReadonlyArray<P>): ReadonlyArray<P> => {
  const taken = new Set(pieces.map((piece) => pieceLabelOf(piece)))
  const next = new Map<string, number>()
  return pieces.map((piece) => {
    const label = pieceLabelOf(piece)
    let ordinal = next.get(label)
    if (ordinal === undefined) {
      next.set(label, 2)
      return piece
    }
    while (taken.has(pieceLabelOf({ ...piece, ordinal }))) ordinal += 1
    next.set(label, ordinal + 1)
    return { ...piece, ordinal }
  })
}

/** A class or asset name written out: "BP_SkyBlue_Metal" reads "Sky Blue Metal". For names that aren't pieces. */
export const humanizedClass = (className: string): string =>
  className.replace(/^(?:BP|MP)_/, "").replace(/_+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || className
