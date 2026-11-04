import { describe, expect, it } from "vitest"
import { isSteamProcess } from "./steam.ts"

describe("steam", () => {
  it("knows the Steam client by its command line", () => {
    expect(isSteamProcess("/home/me/.local/share/Steam/ubuntu12_32/steam\0-silent\0")).toBe(true)
    expect(isSteamProcess("/usr/bin/steam\0")).toBe(true)
    expect(isSteamProcess("steam\0")).toBe(true)
  })

  it("does not take another process on a reused pid for Steam", () => {
    expect(isSteamProcess("/usr/bin/steamwebhelper\0")).toBe(false)
    expect(isSteamProcess("node\0tools/driver/src/main.ts\0serve\0")).toBe(false)
    expect(isSteamProcess("")).toBe(false)
  })
})
