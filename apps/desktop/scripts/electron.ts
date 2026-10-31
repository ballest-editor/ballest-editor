// What start-electron.ts and dev-electron.ts share: where the Electron binary is and the environment to run it in.
import { createRequire } from "node:module"
import * as path from "node:path"

export const desktopDir = path.join(import.meta.dirname, "..")

const resolveElectronPath = (): string => {
  // Required from Node, `electron` is the binary's path; its types describe the API main sees.
  const resolved: unknown = createRequire(import.meta.url)("electron")
  if (typeof resolved !== "string") throw new Error("require(\"electron\") did not return the binary's path")
  return resolved
}

/** The first require downloads the binary (~100 MB, cached in ~/.cache/electron). */
export const electronPath = resolveElectronPath()

/**
 * The parent's environment without ELECTRON_RUN_AS_NODE. Electron-based terminals and editors (T3 Code, VS Code)
 * export it, and it makes the binary a plain Node, where `require("electron")` returns a path instead of the API.
 */
export const electronEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const env = { ...process.env, ...extra }
  delete env["ELECTRON_RUN_AS_NODE"]
  return env
}
