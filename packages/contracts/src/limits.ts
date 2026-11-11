import { Context } from "effect"

/**
 * The game's limit on a map file as text, here because both sides apply it: the page on the text it encodes, main on
 * the files it reads and the bytes Export copies. Measured on 0.4.1 at its boundary (docs/qa/budget.md).
 *
 * It counts the text the game decodes, not the file's bytes: UTF-16 code units, as JavaScript's `length` does, so a
 * character outside the BMP is two, and no BOM, which `TextDecoder` drops too (docs/qa/limits-validation.md).
 */
export const CHARACTERS_PER_FILE = 67_108_864

/** The limit main holds files to, and the most bytes a file within it can take. */
export interface FileLimit {
  readonly charactersPerFile: number
  /**
   * Three bytes per code unit as UTF-8 (a character outside the BMP is four for two), and a BOM. Main checks a file's
   * size against it before reading one, then counts.
   */
  readonly maxFileBytes: number
}

export const fileLimitOf = (charactersPerFile: number): FileLimit => ({
  charactersPerFile,
  maxFileBytes: 3 * charactersPerFile + 3
})

/**
 * The limit main's services read: the game's, unless a test provides a small one, so the rule is proved without
 * reading 64 Mi characters.
 */
export const FileLimit = Context.Reference<FileLimit>("ballest/contracts/FileLimit", {
  defaultValue: () => fileLimitOf(CHARACTERS_PER_FILE)
})

/** What the game rejects in the file as text: whitespace counts, and so does the game's layout of it. */
export const fileTextProblems = (
  text: string,
  charactersPerFile: number = CHARACTERS_PER_FILE
): ReadonlyArray<string> =>
  text.length > charactersPerFile
    ? [
      `The map's file has ${text.length} characters (maximum ${charactersPerFile}): past that the game opens a blank map instead.`
    ]
    : []
