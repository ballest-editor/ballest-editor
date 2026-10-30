// Downloads the Electron binary if it isn't installed yet. pnpm doesn't run electron's postinstall
// (`allowBuilds.electron: false` in pnpm-workspace.yaml), so this runs the same install.js on demand.
// @electron/get caches the download in ~/.cache/electron, which CI keeps between runs.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as path from "node:path"

const require = createRequire(import.meta.url)
const electronDir = path.dirname(require.resolve("electron/package.json"))

const binary = () => {
  const pathFile = path.join(electronDir, "path.txt")
  if (!fs.existsSync(pathFile)) return undefined
  const file = path.join(electronDir, "dist", fs.readFileSync(pathFile, "utf8"))
  return fs.existsSync(file) ? file : undefined
}

if (binary() === undefined) {
  const result = spawnSync(process.execPath, [path.join(electronDir, "install.js")], {
    cwd: electronDir,
    stdio: "inherit"
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const installed = binary()
if (installed === undefined) {
  console.error(`Electron's install.js finished but no binary is in ${electronDir}/dist`)
  process.exit(1)
}
console.log(installed)
