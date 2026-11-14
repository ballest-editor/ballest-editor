import { assert, describe, it } from "@effect/vitest"
import { upright } from "../../../test/placement"
import { quatFromAxisAngle, rotateVec, vecDot } from "../../ueMath"
import { trianglesOfPlacement } from "../look/views"
import {
  bigParts,
  componentPiece,
  componentsOf,
  joined,
  measured,
  primitiveParts,
  splitComponents,
  wholePiece
} from "./meshParts"

const piece = upright

/** A signpost: a slab of ground, a post standing clear of it, and a ball floating over the post. */
const ground = piece("box", [0, 0, 0], [500, 400, 60])
const post = piece("cylinder", [150, 0, 420], [12, 12, 320])
const ball = piece("sphere", [150, 0, 900], [70, 70, 70])
const shapes = [ground, post, ball].map(trianglesOfPlacement)
const signpost = joined(shapes)
/** A cell of a 32-cell grid over the signpost. */
const VOXEL = 1000 / 32

describe("componentsOf", () => {
  it("gives each separate part its own triangles, in the order the parts start in", () => {
    const parts = componentsOf(signpost)
    assert.deepStrictEqual(parts.map((part) => Math.round(measured(part).centre.z)), [0, 420, 900])
    // Welding drops the faces that close to a point at a ball's poles, and no others.
    assert.deepStrictEqual(
      parts.slice(0, 2).map((part) => part.length),
      shapes.slice(0, 2).map((shape) => shape.length)
    )
    assert.isAtMost(parts[2]?.length ?? Infinity, shapes[2]?.length ?? 0)
  })

  it("keeps a single shape whole", () => {
    assert.strictEqual(componentsOf(trianglesOfPlacement(ball)).length, 1)
  })
})

describe("measured", () => {
  it("finds a tilted rod's long axis, its half sizes and its middle", () => {
    const tilt = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.7)
    const rod = { ...post, rotation: tilt }
    const { area, axes, centre, half } = measured(trianglesOfPlacement(rod))
    assert.isAbove(Math.abs(vecDot(axes[0], rotateVec(tilt, { x: 0, y: 0, z: 1 }))), 0.999)
    assert.closeTo(half[0], 320, 1)
    assert.closeTo(half[1], 12, 1)
    assert.closeTo(half[2], 12, 1)
    assert.closeTo(centre.x, 150, 1)
    assert.closeTo(centre.z, 420, 1)
    // The side and the two ends of a 24 by 640 cylinder, less what its facets cut off.
    assert.closeTo(area, 2 * Math.PI * 12 * 640 + 2 * Math.PI * 12 * 12, 0.05 * area)
  })

  it("orders a slab's sides longest first", () => {
    const { half } = measured(trianglesOfPlacement(ground))
    assert.deepStrictEqual(half.map(Math.round), [500, 400, 60])
  })
})

describe("splitComponents", () => {
  it("keeps the largest part as the body and takes a rod and a small part as limbs, largest first", () => {
    const split = splitComponents(signpost, VOXEL)
    assert.strictEqual(split?.body.length, shapes[0]?.length)
    assert.deepStrictEqual(split?.limbs.map((limb) => Math.round(limb.half[0])), [70, 320])
  })

  it("splits nothing with one part, or with no limbs", () => {
    assert.isUndefined(splitComponents(shapes[0] ?? new Float32Array(), VOXEL))
    const blocks = [ground, piece("box", [0, 0, 600], [300, 250, 200])].map(trianglesOfPlacement)
    assert.isUndefined(splitComponents(joined(blocks), VOXEL))
  })

  it("lets the largest part be a limb when the body needn't come first", () => {
    const rod = trianglesOfPlacement(post)
    const split = splitComponents(rod, VOXEL, false)
    assert.strictEqual(split?.body.length, 0)
    assert.deepStrictEqual(split?.limbs.map((limb) => limb.triangles.length), [rod.length])
  })

  it("keeps a big thin sheet in the body and takes a small one as a limb", () => {
    const sail = trianglesOfPlacement(piece("box", [0, 0, 500], [4, 350, 300]))
    const flag = trianglesOfPlacement(piece("box", [300, 0, 900], [2, 110, 70]))
    const split = splitComponents(joined([shapes[0] ?? sail, sail, flag]), VOXEL)
    assert.strictEqual(split?.body.length, (shapes[0]?.length ?? 0) + sail.length)
    assert.deepStrictEqual(split?.limbs.map((limb) => limb.triangles.length), [flag.length])
  })
})

describe("componentPiece", () => {
  it("stands a rod in with a long piece along it, and refines it no worse", () => {
    const part = measured(trianglesOfPlacement(post))
    const fit = componentPiece(part)
    assert.include(["cylinder", "capsule", "box"], fit.piece.kind)
    assert.isAbove(Math.abs(rotateVec(fit.piece.rotation, { x: 0, y: 0, z: 1 }).z), 0.99)
    assert.closeTo(fit.piece.half.z, 320, 5)
    assert.isAtLeast(fit.judge(fit.refined()), fit.judge(fit.piece))
  })

  it("fits a part once", () => {
    const part = measured(trianglesOfPlacement(ball))
    const fit = componentPiece(part)
    assert.strictEqual(componentPiece(part), fit)
    assert.strictEqual(fit.refined(), fit.refined())
  })
})

describe("whole parts", () => {
  const model = componentsOf(signpost).map(measured)
  const total = model.reduce((sum, part) => sum + part.area, 0)
  const [, , ballPart] = model

  it("takes a ball with a small share of the surface as one sphere", () => {
    assert.isDefined(ballPart)
    const found = wholePiece(ballPart, total)
    assert.strictEqual(found?.kind, "sphere")
    assert.closeTo(found?.half.x ?? 0, 70, 8)
  })

  it("leaves a part with too little or too much of the surface", () => {
    assert.isDefined(ballPart)
    assert.isUndefined(wholePiece(ballPart, ballPart.area * 200))
    assert.isUndefined(wholePiece(ballPart, ballPart.area * 3))
  })

  it("gives the parts that get a primitive their pieces and joins the rest", () => {
    const found = primitiveParts(shapes, (part) => part.triangles.length === shapes[2]?.length ? ball : undefined)
    assert.deepStrictEqual(found?.pieces, [ball])
    assert.deepStrictEqual(found?.rest, joined([shapes[0] ?? new Float32Array(), shapes[1] ?? new Float32Array()]))
    assert.isUndefined(primitiveParts(shapes, () => undefined))
  })

  it("finds the large parts that each look like one primitive", () => {
    const moon = piece("sphere", [0, 0, 700], [260, 260, 260])
    const found = bigParts(
      joined([trianglesOfPlacement(ground), trianglesOfPlacement(moon), shapes[1] ?? new Float32Array()])
    )
    assert.deepStrictEqual(found?.pieces.map((p) => p.kind).sort(), ["box", "sphere"])
    assert.strictEqual(found?.rest.length, shapes[1]?.length)
  })
})
