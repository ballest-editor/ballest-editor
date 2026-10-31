import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import * as Fs from "node:fs"
import { installDirOf, libraryFoldersOf, parseVdf, personaNameOf, vdfGet } from "./vdf"

const fixture = (name: string) => Fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8")

describe("vdf", () => {
  it("lists the libraries of a Windows libraryfolders.vdf, unescaping backslashes", () => {
    assert.deepStrictEqual(libraryFoldersOf(fixture("libraryfolders.windows.vdf")), [
      "C:\\Program Files (x86)\\Steam",
      "D:\\SteamLibrary"
    ])
  })

  it("lists the libraries of a Linux libraryfolders.vdf", () => {
    assert.deepStrictEqual(libraryFoldersOf(fixture("libraryfolders.linux.vdf")), [
      "/home/player/.local/share/Steam",
      "/mnt/games/SteamLibrary"
    ])
  })

  it("lists the libraries of the pre-2021 format, skipping its settings and comments", () => {
    assert.deepStrictEqual(libraryFoldersOf(fixture("libraryfolders.legacy.vdf")), [
      "D:\\Games\\Steam Library",
      "E:\\SteamLibrary"
    ])
  })

  it("reads the install folder from the game's app manifest", () => {
    assert.deepStrictEqual(installDirOf(fixture("appmanifest_3339810.acf")), Option.some("Ballest of Them All"))
    assert.deepStrictEqual(installDirOf("\"AppState\" { \"appid\" \"3339810\" }"), Option.none())
  })

  it("matches keys case-insensitively and keeps nested blocks", () => {
    const parsed = Option.getOrThrow(
      parseVdf("\"AppState\" { \"InstallDir\" \"x\" \"UserConfig\" { \"language\" \"english\" } }")
    )
    const state = vdfGet(parsed, "appstate")
    assert.isTrue(typeof state === "object")
    if (typeof state !== "object") return
    assert.strictEqual(vdfGet(state, "installdir"), "x")
    assert.deepStrictEqual(vdfGet(state, "userconfig"), { language: "english" })
  })

  it("reads bare tokens and escapes", () => {
    assert.deepStrictEqual(
      parseVdf("root { key value \"q\" \"a\\\"b\\tc\" }"),
      Option.some({ root: { key: "value", q: "a\"b\tc" } })
    )
  })

  it("refuses malformed documents", () => {
    for (const text of ["\"a\" {", "\"a\" { \"b\" }", "\"a\" }", "\"a\" \"unterminated", "{ }"]) {
      assert.isTrue(Option.isNone(parseVdf(text)), text)
    }
    assert.deepStrictEqual(libraryFoldersOf("not a vdf {"), [])
    assert.deepStrictEqual(installDirOf(""), Option.none())
  })

  it("takes the persona name of the user Steam marks MostRecent", () => {
    assert.deepStrictEqual(personaNameOf(fixture("loginusers.several.vdf")), Option.some("Speedy Marble"))
  })

  it("takes the newest login when no user is marked MostRecent (Steam on Linux)", () => {
    assert.deepStrictEqual(personaNameOf(fixture("loginusers.linux.vdf")), Option.some("Rolling Stone"))
  })

  it("returns a persona name the editor can't use as it is", () => {
    assert.deepStrictEqual(personaNameOf(fixture("loginusers.invalid.vdf")), Option.some("xX_Marble_Xx ★"))
  })

  it("finds no persona name without users", () => {
    for (const text of ["", "\"users\" { }", "\"users\" { \"7656\" { \"AccountName\" \"a\" } }", "\"other\" { }"]) {
      assert.deepStrictEqual(personaNameOf(text), Option.none(), text)
    }
  })
})
