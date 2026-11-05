import { assert, describe, it } from "@effect/vitest"
import { linkTextOf } from "./releaseNotes"

describe("linkTextOf", () => {
  it("shows a pull request or issue whose text is its own address as its number", () => {
    const pull = "https://github.com/ballest-editor/ballest-editor/pull/209"
    assert.strictEqual(linkTextOf(pull, pull), "#209")
    const issue = "https://github.com/ballest-editor/ballest-editor/issues/42"
    assert.strictEqual(linkTextOf(issue, issue), "#42")
  })

  it("shows a compare link as its range", () => {
    const compare = "https://github.com/ballest-editor/ballest-editor/compare/v0.1.3...v0.2.0"
    assert.strictEqual(linkTextOf(compare, compare), "v0.1.3...v0.2.0")
  })

  it("leaves every other link's text alone", () => {
    const pull = "https://github.com/ballest-editor/ballest-editor/pull/209"
    assert.strictEqual(linkTextOf("the fix", pull), "the fix")
    const release = "https://github.com/ballest-editor/ballest-editor/releases/tag/v0.2.0"
    assert.strictEqual(linkTextOf(release, release), release)
    const elsewhere = "https://example.com/pull/209"
    assert.strictEqual(linkTextOf(elsewhere, elsewhere), elsewhere)
    const files = "https://github.com/ballest-editor/ballest-editor/pull/209/files"
    assert.strictEqual(linkTextOf(files, files), files)
  })
})
