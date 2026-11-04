/**
 * The game's limit on a map file as text, here because both sides apply it: the page on the text it encodes, main on
 * the bytes Export copies. Measured on 0.4.1 at its boundary (docs/qa/budget.md).
 */
export const CHARACTERS_PER_FILE = 67_108_864

/** What the game rejects in the file as text: whitespace counts, and so does the game's layout of it. */
export const fileTextProblems = (text: string): ReadonlyArray<string> =>
  text.length > CHARACTERS_PER_FILE
    ? [
      `The map's file has ${text.length} characters (maximum ${CHARACTERS_PER_FILE}): past that the game opens a blank map instead.`
    ]
    : []
