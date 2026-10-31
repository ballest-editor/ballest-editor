// Launches the built app (dist-electron/main.cjs, against apps/web/dist). Requiring `electron` from Node downloads
// its binary on first use (~100 MB, cached in ~/.cache/electron). ELECTRON_RUN_AS_NODE is cleared because an
// Electron-based terminal or editor may export it, which would make the binary a plain Node.
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import * as path from "node:path"

const electron = createRequire(import.meta.url)("electron")
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, [path.join(import.meta.dirname, ".."), ...process.argv.slice(2)], {
  stdio: "inherit",
  env
})
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
child.on("exit", (code, signal) => process.exit(signal === null ? (code ?? 0) : 1))
