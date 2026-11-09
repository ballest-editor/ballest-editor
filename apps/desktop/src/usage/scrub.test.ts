import { ERROR_TEXT_LIMIT } from "@ballest/contracts"
import { describe, expect, it } from "@effect/vitest"
import { scrubErrorText } from "./scrub"

const linux = { home: "/home/robin", user: "robin" }
const windows = { home: "C:\\Users\\Robin", user: "Robin" }

describe("scrubErrorText", () => {
  it.each([
    // The home folder becomes ~, in either slash style and any case on Windows.
    [linux, "ENOENT: /home/robin/Documents/x.json", "ENOENT: ~/Documents/x.json"],
    [windows, "at C:\\Users\\Robin\\AppData\\x.js:1", "at ~\\AppData\\x.js:1"],
    [windows, "at c:/users/robin/AppData/x.js:1", "at ~/AppData/x.js:1"],
    [windows, "file:///C:/Users/Robin/x.js", "file:///~/x.js"],
    // The user name anywhere else, as a whole word only.
    [linux, "owner robin denied", "owner <user> denied"],
    [linux, "robinson is fine", "robinson is fine"],
    // Map and prefab file names, wherever they are.
    [linux, "Couldn't save Map_LevelEditorMain&Spiral_Robin.balledit.", "Couldn't save <map>."],
    [linux, "read /tmp/My Track.ballmap failed", "read /tmp/<map> failed"],
    [linux, "bad prefab ramp-kit.ballprefab", "bad prefab <map>"],
    // Absolute paths outside the home folder keep only their last segment.
    [linux, "open /mnt/games/steam/x.vdf", "open <path>/x.vdf"],
    [windows, "open D:\\SteamLibrary\\steamapps\\x.vdf", "open <path>\\x.vdf"],
    // The app's own code in an installed build stays readable.
    [windows, "at C:\\Program Files\\Ballest Editor\\resources\\app.asar\\main.cjs:9:1", "at <app>/main.cjs:9:1"],
    [
      linux,
      "at /opt/Ballest Editor/resources/app.asar/web/assets/index-abc.js:1:2",
      "at <app>/web/assets/index-abc.js:1:2"
    ],
    [linux, "at ballest://app/assets/index-abc.js:1:2", "at ballest://app/assets/index-abc.js:1:2"]
  ])("%j: %s", (who, input, expected) => {
    expect(scrubErrorText(input, who)).toBe(expected)
  })

  it("cuts what is left to the limit", () => {
    const text = scrubErrorText("x".repeat(ERROR_TEXT_LIMIT * 2), linux)
    expect(text.length).toBe(ERROR_TEXT_LIMIT)
    expect(text.endsWith("…")).toBe(true)
  })

  it("leaves a short name alone rather than scrub every word that contains it", () => {
    expect(scrubErrorText("an error in a", { home: "/home/a", user: "a" })).toBe("an error in a")
  })
})
