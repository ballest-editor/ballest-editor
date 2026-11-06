import { readFileSync } from "node:fs"

/** The UI's stylesheet as written. Vitest empties a `.css` import, `?raw` included. */
export const globalsCss = readFileSync(
  new URL("../../../../packages/ui/src/styles/globals.css", import.meta.url),
  "utf8"
)
