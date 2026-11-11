// `node tools/dev/src/run-turbo.ts <turbo args>`, what the root scripts that run turbo call: turbo with the cache every
// worktree shares (turbo.ts).
import { runTurbo } from "./turbo.ts"

runTurbo(process.argv.slice(2), process.env["npm_lifecycle_event"] ?? "test")
