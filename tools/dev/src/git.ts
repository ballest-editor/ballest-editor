/** git, for the dev tools. */
import { execFileSync } from "node:child_process"

export const git = (...args: ReadonlyArray<string>) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()

/** The .git folder every worktree of this clone shares. Throws outside a git checkout. */
export const gitCommonDir = () => git("rev-parse", "--path-format=absolute", "--git-common-dir")
