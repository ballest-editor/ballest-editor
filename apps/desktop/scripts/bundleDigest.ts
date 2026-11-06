import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

/**
 * What `names` in `dir` hold, as one hash; a file that isn't there counts as empty. The watch build rewrites a bundle
 * for more than an edit: a `pnpm install` in another checkout changes the inodes `node_modules` shares with it through
 * pnpm's store. `dev-electron.ts` compares this, because only different bytes are worth a restart.
 */
export const bundleDigest = (dir: string, names: Iterable<string>): string => {
  const hash = createHash("sha256")
  for (const name of [...names].toSorted()) {
    const file = path.join(dir, name)
    hash.update(name).update("\0").update(fs.existsSync(file) ? fs.readFileSync(file) : "").update("\0")
  }
  return hash.digest("hex")
}
