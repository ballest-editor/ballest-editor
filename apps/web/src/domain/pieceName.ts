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

type Named = Pick<CatalogPiece, "className" | "displayName">

const SIZE_WORDS: Readonly<Record<PieceSize, string>> = { S: "Small", M: "Medium", L: "Large" }

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
 * The class name stays out of the name: show it in a tooltip.
 */
export const pieceDisplayName = (piece: Named): PieceName =>
  piece.displayName ? fromGameName(piece.displayName, piece.className) : fromClassName(piece.className)

const joined = (piece: Named, separator: string): string => {
  const { name, size } = pieceDisplayName(piece)
  return size === undefined ? name : `${name}${separator}${SIZE_WORDS[size]}`
}

/** The name as one string, the size written out ("Curve 1 Small"), for lists with no room for a tag. */
export const pieceLabelOf = (piece: Named): string => joined(piece, " ")

/** The name with the size set apart ("Curve 1 · Medium"), for a tooltip's first line. */
export const pieceTitleOf = (piece: Named): string => joined(piece, " · ")

/** A class or asset name written out: "BP_SkyBlue_Metal" reads "Sky Blue Metal". For names that aren't pieces. */
export const humanizedClass = (className: string): string =>
  className.replace(/^(?:BP|MP)_/, "").replace(/_+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || className
