import { assert, describe, it } from "@effect/vitest"
import { pathInFolder } from "./paths"

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
