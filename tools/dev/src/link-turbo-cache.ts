// `node tools/dev/src/link-turbo-cache.ts`, from `pnpm install` (the root `prepare` script): links this worktree's
// turbo cache to the one every worktree shares, so even a bare `turbo` uses it (turbo.ts).
import { linkTurboCache } from "./turbo.ts"

linkTurboCache()
