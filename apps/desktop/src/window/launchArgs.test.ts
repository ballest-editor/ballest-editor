import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { inheritedFlags, parseProjectArg, projectArgOf } from "./launchArgs"

describe("parseProjectArg", () => {
  it("finds the folder wherever it is on the command line", () => {
    assert.deepStrictEqual(parseProjectArg(["app", "--project=/a/b"]), Option.some("/a/b"))
    assert.deepStrictEqual(parseProjectArg(["electron", "/app", "--no-sandbox", "--project=/a"]), Option.some("/a"))
  })

  it("keeps a folder with spaces and = as it is", () => {
    assert.deepStrictEqual(
      parseProjectArg(["app", "--project=C:\\Users\\me\\My a=b maps"]),
      Option.some("C:\\Users\\me\\My a=b maps")
    )
  })

  it("is none without one, for an empty one, and for other flags", () => {
    assert.isTrue(Option.isNone(parseProjectArg(["app"])))
    assert.isTrue(Option.isNone(parseProjectArg(["app", "--project="])))
    assert.isTrue(Option.isNone(parseProjectArg(["app", "--project", "/a"])))
    assert.isTrue(Option.isNone(parseProjectArg(["app", "--projects=/a"])))
  })

  it("reads what projectArgOf writes", () => {
    assert.deepStrictEqual(parseProjectArg(["app", projectArgOf("/my maps")]), Option.some("/my maps"))
  })
})

describe("inheritedFlags", () => {
  it("keeps the flags this window ran with, not its project, its DevTools port or the app's path", () => {
    assert.deepStrictEqual(
      inheritedFlags([
        "electron",
        "/app",
        "--no-sandbox",
        "--project=/a",
        "--remote-debugging-port=9222",
        "--use-angle=swiftshader"
      ]),
      ["--no-sandbox", "--use-angle=swiftshader"]
    )
  })
})
