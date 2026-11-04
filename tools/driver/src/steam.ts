import { Effect, type FileSystem } from "effect"
import { homedir } from "node:os"
import { join } from "node:path"

/** Steam's own record of its client process: the pid it writes at start (and leaves behind when it quits). */
export const STEAM_PID_FILE = join(homedir(), ".steam", "steam.pid")

/**
 * Whether the process Steam's pid file names is Steam. The file outlives the client, and its pid can be reused by
 * another process, so what runs under that pid has to be checked.
 */
export const isSteamProcess = (cmdline: string): boolean => cmdline.split("\0").some((arg) => /(^|\/)steam$/.test(arg))

/**
 * Whether the Steam client is running. A copy of the game needs it: without it the launcher forwards a `steam://run`
 * request instead of starting the game, and a copy that started Steam itself would leave Steam with the copy's
 * environment (the plugin manager's `test_instance.py` makes the same check).
 */
export const steamRunning = (fs: FileSystem.FileSystem): Effect.Effect<boolean> =>
  Effect.gen(function*() {
    const pid = (yield* fs.readFileString(STEAM_PID_FILE)).trim()
    if (!/^\d+$/.test(pid)) return false
    return isSteamProcess(yield* fs.readFileString(`/proc/${pid}/cmdline`))
  }).pipe(Effect.orElseSucceed(() => false))

export const STEAM_NOT_RUNNING =
  "Steam isn't running. Don't start it yourself: ask the user to start Steam and to say when it is running, then try again."
