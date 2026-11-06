import { assert, describe, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fadeFineLines } from "./floorGrid"

const dreiGridSource = () =>
  readFileSync(join(dirname(createRequire(import.meta.url).resolve("@react-three/drei")), "core/Grid.js"), "utf8")

describe("the floor grid's fine lines", () => {
  it("replaces both of the lines it needs in drei's shader", () => {
    const patched = fadeFineLines(dreiGridSource())
    assert.include(patched, "vec2 lines =")
    assert.include(patched, "return max(lines.x, lines.y);")
    assert.notInclude(patched, "float line =")
    assert.notInclude(patched, "min(line, 1.0)")
  })
})
