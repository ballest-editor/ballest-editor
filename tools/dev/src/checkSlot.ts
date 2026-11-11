/**
 * The slots every check in this clone shares: `pnpm check:changed` and the root scripts that run turbo (`pnpm test`,
 * `typecheck`, `build`, `check:everything`). Two run at once across all worktrees; the next one waits.
 */
import { join } from "node:path"
import { gitCommonDir } from "./git.ts"
import { acquireSlot, type Slot } from "./slotLock.ts"

export const CHECK_SLOTS = 2

/** Takes a check slot, saying who holds them while it waits. `what` names the waiting command in that message. */
export const acquireCheckSlot = (what: string): Promise<Slot> =>
  acquireSlot({
    dir: join(gitCommonDir(), "check-changed"),
    slots: CHECK_SLOTS,
    onWait: (holders) =>
      console.log(
        `${what} is waiting for a check slot: ${CHECK_SLOTS} checks are going in this clone's worktrees\n  ${
          holders.join("\n  ")
        }`
      )
  })
