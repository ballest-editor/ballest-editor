import { execSync } from "node:child_process"
import type { Plugin } from "vite"
import { readThirdPartyNotices } from "./thirdPartyNotices"

const shortCommit = (commit: string) => commit.slice(0, 9)

/** The commit being built: Vercel's checkout has no history, so it says; `unknown` outside a repository. */
const currentCommit = (repoRoot: string): string => {
  const fromVercel = process.env["VERCEL_GIT_COMMIT_SHA"]
  if (fromVercel !== undefined && fromVercel.length > 0) return shortCommit(fromVercel)
  try {
    return shortCommit(execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8", stdio: "pipe" }).trim())
  } catch {
    return "unknown"
  }
}

const moduleText = (value: unknown, name: string) => `export const ${name} = ${JSON.stringify(value)}`

/**
 * What only the build knows, as modules the app imports: `virtual:build-info` (the commit and the time of the build) and
 * `virtual:third-party-notices`, which the app loads when the list opens, so its text stays out of the first load.
 */
export const buildFacts = (repoRoot: string): Plugin => {
  // The app driver's captures have to match across commits and servers, so these can't vary under it.
  const pinned = process.env["BALLEST_PIN_BUILD_INFO"] !== undefined
  const builtAt = pinned ? "2026-01-01T12:00:00.000Z" : new Date().toISOString()
  const modules: Readonly<Record<string, () => string>> = {
    "virtual:build-info": () =>
      moduleText({ commit: pinned ? "0000000" : currentCommit(repoRoot), builtAt }, "buildInfo"),
    "virtual:third-party-notices": () => moduleText(readThirdPartyNotices(repoRoot), "notices")
  }
  const resolved = (id: string) => `\0${id}`
  return {
    name: "ballest:build-facts",
    resolveId: (id) => id in modules ? resolved(id) : undefined,
    load: (id) => id.startsWith("\0") ? modules[id.slice(1)]?.() : undefined
  }
}
