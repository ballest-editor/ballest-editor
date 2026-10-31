// Launches the built app (dist-electron/main.cjs, against apps/web/dist).
import { spawn } from "node:child_process"
import { desktopDir, electronEnv, electronPath } from "./electron.ts"

const child = spawn(electronPath, [desktopDir, ...process.argv.slice(2)], { stdio: "inherit", env: electronEnv() })
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal))
child.on("exit", (code, signal) => process.exit(signal === null ? (code ?? 0) : 1))
