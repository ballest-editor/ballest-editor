import { assert, describe, it } from "@effect/vitest"
import { folderLabelOf, pathInFolder } from "./paths"

describe("pathInFolder", () => {
  it("uses the folder's own separator", () => {
    assert.strictEqual(
      pathInFolder(String.raw`C:\Users\me\Documents\Ballest Editor`, "My tracks"),
      String.raw`C:\Users\me\Documents\Ballest Editor\My tracks`
    )
    assert.strictEqual(
      pathInFolder("/home/me/Documents/Ballest Editor", "My tracks"),
      "/home/me/Documents/Ballest Editor/My tracks"
    )
  })
})

describe("folderLabelOf", () => {
  it("keeps the folder and the one it is in, whatever the separator", () => {
    assert.strictEqual(
      folderLabelOf(String.raw`C:\Users\me\Documents\Ballest Editor\My tracks`),
      "Ballest Editor › My tracks"
    )
    assert.strictEqual(folderLabelOf("/home/me/Documents/Ballest Editor/My tracks/"), "Ballest Editor › My tracks")
  })
})
