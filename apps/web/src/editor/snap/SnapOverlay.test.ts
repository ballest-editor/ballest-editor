import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import type { SnapMark } from "../../domain/snapFrame"
import { ORIGIN } from "../../domain/ueMath"
import { isLine, isMesh } from "../threeGuards"
import { GLYPHS, glyphSegments, RELATION_NAMES, SNAP_COLORS } from "./snapGlyphs"
import { drawMark, MarkLayer } from "./SnapOverlay"

const X = { x: 100, y: 0, z: 0 }
const square = [ORIGIN, X, { x: 100, y: 100, z: 0 }, { x: 0, y: 100, z: 0 }]

/** The colours of what one mark draws, as hex. */
const drawn = (mark: SnapMark) => {
  const layer = new MarkLayer()
  drawMark(layer, mark, true)
  const colours: Array<string> = []
  layer.traverse((object) => {
    if (!isMesh(object) && !isLine(object)) return
    const { material } = object
    if (material instanceof THREE.MeshBasicMaterial || material instanceof THREE.LineBasicMaterial) {
      colours.push(`#${material.color.getHexString()}`)
    }
  })
  return { layer, colours }
}

describe("the snap overlay's marks", () => {
  it("draws each side of a snap in its own colour", () => {
    for (const role of ["source", "target"] as const) {
      const marks: ReadonlyArray<SnapMark> = [
        { kind: "dot", role, at: ORIGIN },
        { kind: "ring", role, at: ORIGIN },
        { kind: "line", role, from: ORIGIN, to: X },
        { kind: "face", role, corners: square }
      ]
      for (const mark of marks) assert.deepStrictEqual(new Set(drawn(mark).colours), new Set([SNAP_COLORS[role]]))
    }
  })

  it("ticks both ends of an edge, tints a face and outlines it, and leaves an outline-only face untinted", () => {
    assert.lengthOf(drawn({ kind: "line", role: "target", from: ORIGIN, to: X }).colours, 3)
    assert.lengthOf(drawn({ kind: "face", role: "target", corners: square }).colours, 2)
    assert.lengthOf(drawn({ kind: "face", role: "target", corners: square, outline: true }).colours, 1)
  })

  it("draws a glyph on a badge, sharing its strokes between marks and keeping them past a reset", () => {
    const glyphLines = (layer: MarkLayer) => {
      let lines: THREE.BufferGeometry | undefined
      layer.traverse((object) => {
        if (isLine(object)) lines = object.geometry
      })
      return lines
    }
    const first = drawn({ kind: "glyph", relation: "flush", at: ORIGIN }).layer
    const second = drawn({ kind: "glyph", relation: "flush", at: X }).layer
    const shared = glyphLines(first)
    assert.isDefined(shared)
    assert.strictEqual(glyphLines(second), shared)
    first.reset()
    assert.isAbove(shared.getAttribute("position").count, 0, "a reset leaves the shared strokes alone")
  })
})

describe("the glyphs", () => {
  it("give every kind of snap strokes inside the icon's box, and a name", () => {
    for (const [relation, strokes] of Object.entries(GLYPHS)) {
      assert.isAbove(strokes.length, 0, relation)
      for (const [x1, y1, x2, y2] of glyphSegments(strokes)) {
        assert.isTrue([x1, y1, x2, y2].every((v) => v >= 0 && v <= 24), relation)
      }
    }
    assert.sameMembers(Object.keys(RELATION_NAMES), Object.keys(GLYPHS))
  })

  it("keep the source and target colours apart from each other and from the rest of what snapping draws", () => {
    assert.lengthOf(new Set(Object.values(SNAP_COLORS)), Object.keys(SNAP_COLORS).length)
  })
})
