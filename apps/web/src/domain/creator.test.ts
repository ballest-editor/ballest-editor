import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { creatorChipText, creatorOf, creatorProblem, mapCreatorLabel, usableCreatorName } from "./creator"
import { defaultSettings, mergeSettings } from "./Settings"

const steam = (name: string) => Option.some({ name, source: "steam" as const })

describe("creator", () => {
  it("cuts a chip's name to 18 characters, the ellipsis included", () => {
    assert.strictEqual(creatorChipText("spigipplespigipple"), "spigipplespigipple")
    assert.strictEqual(creatorChipText("spigipplespigipplespigipple"), "spigipplespigippl…")
    assert.strictEqual(creatorChipText("😀".repeat(19)), `${"😀".repeat(17)}…`)
  })

  it("says a map's creator is from Steam unless it is the name typed in Settings", () => {
    assert.strictEqual(mapCreatorLabel("Marble", creatorOf(null, steam("Marble"))), "From Steam")
    assert.strictEqual(mapCreatorLabel("Marble", creatorOf(null, Option.none())), "From Steam")
    assert.strictEqual(mapCreatorLabel("Someone", creatorOf("Marble", Option.none())), "From Steam")
    assert.strictEqual(mapCreatorLabel("Marble", creatorOf("Marble", Option.none())), "From Settings")
  })

  it("uses the name found until one is typed", () => {
    assert.deepStrictEqual(creatorOf(null, steam("Speedy Marble")), {
      name: "Speedy Marble",
      source: "steam",
      valid: true
    })
    assert.deepStrictEqual(creatorOf(" Isaac ", steam("Speedy Marble")), { name: "Isaac", source: "user", valid: true })
    assert.deepStrictEqual(creatorOf(null, Option.none()), { name: "", source: "none", valid: false })
  })

  it("doesn't use a found name the file name rule refuses, and says why", () => {
    const creator = creatorOf(null, steam("xX_Marble_Xx ★"))
    assert.isFalse(creator.valid)
    assert.strictEqual(usableCreatorName(creator), "")
    assert.match(Option.getOrThrow(creatorProblem(creator)), /Your Steam name, "xX_Marble_Xx ★", has characters/)
    assert.isTrue(Option.isNone(creatorProblem(creatorOf(null, steam("Fine")))))
    assert.isTrue(Option.isNone(creatorProblem(creatorOf("", steam("Fine")))))
    assert.isTrue(Option.isSome(creatorProblem(creatorOf("a_b", Option.none()))))
  })

  it("reads an older save's empty creator as unset, and keeps a typed one", () => {
    assert.isNull(mergeSettings({ general: { creatorName: "" } }).general.creatorName)
    assert.strictEqual(mergeSettings({ general: { creatorName: "Isaac" } }).general.creatorName, "Isaac")
    assert.isNull(mergeSettings({ general: { creatorName: 3 } }).general.creatorName)
    assert.isNull(defaultSettings.general.creatorName)
  })
})
