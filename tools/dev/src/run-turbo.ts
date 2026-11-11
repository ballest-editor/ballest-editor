// `node tools/dev/src/run-turbo.ts <turbo args>`, what the root scripts that run turbo call (`pnpm test`, `typecheck`,
// `build`, `check:everything`): turbo with the cache every worktree shares (turbo.ts). Locally a run also waits for one
// of the check slots it shares with `pnpm check:changed` (checkSlot.ts) and starts at most LOCAL_CONCURRENCY tasks at
// once, unless its arguments set `--concurrency`. CI runs it as it is.
import { acquireCheckSlot } from "./checkSlot.ts"
import { LOCAL_CONCURRENCY, runTurbo, withConcurrency } from "./turbo.ts"

const args = process.argv.slice(2)
const script = process.env["npm_lifecycle_event"] ?? "test"

if (process.env["CI"] !== undefined) runTurbo(args, script)
else {
  // The slot is held until this process exits, which runTurbo does when turbo does.
  await acquireCheckSlot(`pnpm ${script}`)
  runTurbo(withConcurrency(args, LOCAL_CONCURRENCY), script)
}
