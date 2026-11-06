import { assert, describe, it } from "@effect/vitest"
import { folderLabelOf, lastSegmentOf, parentFolderName, pathInFolder, shortFolderName } from "./paths"

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

describe("short ways to say where a folder is", () => {
  it("take the end of a path on either platform", () => {
    assert.strictEqual(lastSegmentOf("/home/me/Documents/Ballest Editor/Golf/"), "Golf")
    assert.strictEqual(lastSegmentOf("C:\\Users\\me\\Golf"), "Golf")
    assert.strictEqual(parentFolderName("/home/me/Documents/Ballest Editor/Golf"), "Ballest Editor")
    assert.strictEqual(parentFolderName("C:\\Users\\me\\Golf\\"), "me")
    assert.strictEqual(shortFolderName("/home/me/Documents/Ballest Editor/Golf"), "Ballest Editor/Golf")
    assert.strictEqual(shortFolderName(String.raw`C:\Users\me\Golf`), "me/Golf")
  })

  it("keep a path too short to have a parent", () => {
    assert.strictEqual(parentFolderName("/Golf"), "/Golf")
    assert.strictEqual(shortFolderName("/Golf"), "Golf")
  })
})
