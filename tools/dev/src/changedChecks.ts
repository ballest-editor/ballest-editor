/** Which of a branch's changed files each repo-wide check takes, so `pnpm check:changed` hands it only those. */
const FORMATTED = /\.(ts|tsx|js|mjs|json|md)$/
const LINTED = /^(apps|packages|tools)\/.*\.(ts|tsx|js|mjs)$/
const NOT_FORMATTED = /^(repos|samples|assets|web-assets)\//

export const formattedFiles = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.filter((file) => FORMATTED.test(file) && !NOT_FORMATTED.test(file))

export const lintedFiles = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.filter((file) => LINTED.test(file))
