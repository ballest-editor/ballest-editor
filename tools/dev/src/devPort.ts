import { createHash } from "node:crypto"

/** The main checkout's dev server port, as before worktrees had their own. */
export const BASE_PORT = 3000
/** Linked worktrees land in 3001..5000. */
const SPAN = 2000
/** Ports in that range that browsers refuse to fetch from (https://fetch.spec.whatwg.org/#port-blocking). */
const BLOCKED = new Set([3659, 4045, 4190])

/**
 * The dev server port for a checkout: {@link BASE_PORT} for the main one, and for a linked worktree a port derived
 * from its path, so it is the same on every run (the browser keys localStorage by origin, port included) and two
 * worktrees can run side by side.
 */
export const devPort = (worktree: string | undefined): number => {
  if (worktree === undefined) return BASE_PORT
  let port = BASE_PORT + 1 + (createHash("sha256").update(worktree).digest().readUInt32BE(0) % SPAN)
  while (BLOCKED.has(port)) port += 1
  return port
}
