import { assert, describe, it } from "@effect/vitest"
import { sharedProjectNames } from "./project"

describe("sharedProjectNames", () => {
  it("names only what more than one project goes by, in any case", () => {
    const shared = sharedProjectNames([{ name: "Golf" }, { name: "Tracks" }, { name: "GOLF" }])
    assert.deepStrictEqual([...shared], ["golf"])
  })

  it("is empty when every name is different", () => {
    assert.strictEqual(sharedProjectNames([{ name: "Golf" }, { name: "Tracks" }]).size, 0)
  })
})
