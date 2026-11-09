/**
 * The game's limit on a map file as text, here because both sides apply it: the page on the text it encodes, main on
 * the files it reads and the bytes Export copies. Measured on 0.4.1 at its boundary (docs/qa/budget.md).
 *
 * It counts the text the game decodes, not the file's bytes: UTF-16 code units, as JavaScript's `length` does, so a
 * character outside the BMP is two, and no BOM, which `TextDecoder` drops too (docs/qa/limits-validation.md).
 */
export const CHARACTERS_PER_FILE = 67_108_864

/**
 * The most bytes a file within `CHARACTERS_PER_FILE` can take: three per code unit as UTF-8 (a character outside the
 * BMP is four for two), and a BOM. Main checks a file's size against it before reading one, then counts.
 */
export const MAX_FILE_BYTES = 3 * CHARACTERS_PER_FILE + 3

/** What the game rejects in the file as text: whitespace counts, and so does the game's layout of it. */
export const fileTextProblems = (text: string): ReadonlyArray<string> =>
  text.length > CHARACTERS_PER_FILE
    ? [
      `The map's file has ${text.length} characters (maximum ${CHARACTERS_PER_FILE}): past that the game opens a blank map instead.`
    ]
    : []
