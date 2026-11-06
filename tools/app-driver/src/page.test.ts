import { describe, expect, it } from "vitest"
import { formatAxTree, sizeOf } from "./page.ts"

describe("formatAxTree", () => {
  it("keeps what a reader needs and folds away what carries nothing", () => {
    const tree = formatAxTree([
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2", "5"] },
      { nodeId: "2", role: { value: "generic" }, childIds: ["3"] },
      { nodeId: "3", role: { value: "button" }, name: { value: "Save" }, childIds: ["4"] },
      { nodeId: "4", role: { value: "StaticText" }, name: { value: "Save" } },
      { nodeId: "5", role: { value: "image" }, ignored: true }
    ])
    expect(tree).toBe("button \"Save\"\n  StaticText \"Save\"")
  })
})

describe("sizeOf", () => {
  it("reads a window axis", () => {
    expect(sizeOf("1280x800")).toEqual({ width: 1280, height: 800 })
  })
})
