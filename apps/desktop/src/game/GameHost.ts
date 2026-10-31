import { Context, Layer } from "effect"
import * as Os from "node:os"
import type { HostInfo } from "./locations"

/** The machine the game paths are looked up on. Tests give a fake home, environment and `/proc`. */
export class GameHost extends Context.Service<
  GameHost,
  HostInfo & {
    /** Linux's process table, scanned for the game's process. */
    readonly procDir: string
  }
>()("ballest/desktop/game/GameHost") {
  static readonly layer = Layer.sync(GameHost, () =>
    GameHost.of({
      platform: process.platform,
      home: Os.homedir(),
      env: { ...process.env },
      procDir: "/proc"
    }))
}
