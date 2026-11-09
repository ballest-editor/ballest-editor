import { describe, expect, it } from "@effect/vitest"
import { firstLine, sanitise, TITLE_LIMIT } from "./sanitise"

const J = "⁠"

describe("sanitise", () => {
  it.each([
    ["plain text stays", "The ramp floats.", "The ramp floats."],
    ["CRLF becomes LF", "one\r\ntwo\rthree", "one\ntwo\nthree"],
    ["a mention is defused", "ping @octocat please", `ping @${J}octocat please`],
    ["a team mention is defused", "@ballest-editor/maintainers", `@${J}ballest-editor/maintainers`],
    ["a mention in parentheses", "(@octocat)", `(@${J}octocat)`],
    ["a mention behind a character reference", "&#64;octocat", `&amp;#${J}64;octocat`],
    ["a named reference is kept as text", "a &lt;b&gt; c", "a &amp;lt;b&amp;gt; c"],
    ["an issue reference", "like #12 and #3", `like #${J}12 and #${J}3`],
    ["a cross-repo reference", "see owner/repo#99", `see owner/repo#${J}99`],
    ["a GH- reference", "GH-7 and gh-8", `GH-${J}7 and gh-${J}8`],
    ["a heading isn't a reference", "# Steps", "# Steps"],
    [
      "an issue URL becomes a code span",
      "see https://github.com/ballest-editor/ballest-editor/issues/12 now",
      "see `https://github.com/ballest-editor/ballest-editor/issues/12` now"
    ],
    [
      "a pull URL in a link becomes a code span",
      "[here](https://github.com/o/r/pull/3)",
      "[here](`https://github.com/o/r/pull/3`)"
    ],
    ["a bare github.com URL", "www.github.com/o/r/issues/4", "`www.github.com/o/r/issues/4`"],
    ["an inline image is stripped", "look ![shot](https://evil.example/x.png) here", "look  here"],
    ["a reference image is stripped", "look ![shot][1] here", "look  here"],
    ["a link stays", "[docs](https://example.com)", "[docs](https://example.com)"],
    ["a tag is stripped", "a <img src=x onerror=alert(1)> b", "a  b"],
    ["paired tags are stripped, text kept", "<details><summary>hi</summary>body</details>", "hibody"],
    ["a comment is stripped", "a<!-- hidden @octocat -->b", "ab"],
    ["an unclosed comment hides nothing", "a<!-- rest", "a"],
    ["a comparison stays", "speed 3 < 4", "speed 3 < 4"],
    ["an email gets a joiner too", "me@example.com", `me@${J}example.com`]
  ])("%s", (_name, input, expected) => {
    expect(sanitise(input)).toBe(expected)
  })
})

describe("firstLine", () => {
  it("takes the first line with text", () => {
    expect(firstLine("\n  \n  Ramp floats  \nmore")).toBe("Ramp floats")
  })

  it("cuts a long line with an ellipsis", () => {
    const title = firstLine("x".repeat(200))
    expect(Array.from(title ?? "")).toHaveLength(TITLE_LIMIT)
    expect(title?.endsWith("…")).toBe(true)
  })

  it("has none for a message with no text", () => {
    expect(firstLine("  \n ")).toBeUndefined()
  })
})
