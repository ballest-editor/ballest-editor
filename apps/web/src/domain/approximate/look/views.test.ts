import { assert, describe, it } from "@effect/vitest"
import { boxTriangles, countOf } from "../../../test/boxTriangles"
import { quatFromAxisAngle } from "../../ueMath"
import { forEachCellIn, toGridShape } from "../grid/raster"
import { at, cellCount, gridOver, voxelize } from "../grid/voxelize"
import { IDENTITY_QUAT, type Placement, shapeKinds } from "../shapes"
import {
  compareViews,
  drawnOver,
  edgesOf,
  lookOf,
  lookOfPlacements,
  modelViews,
  picturesOf,
  piecePictures,
  regionsOf,
  trianglesOfPlacement,
  viewFrameOf
} from "./views"

const block = boxTriangles([0, 0, 0], [1000, 2000, 500])
const frame = viewFrameOf(block)
const views = modelViews(block)

/** The block as one cube, and pieces that are not it. */
const itself: Placement = {
  kind: "box",
  center: { x: 500, y: 1000, z: 250 },
  half: { x: 500, y: 1000, z: 250 },
  rotation: IDENTITY_QUAT
}
const ball: Placement = { ...itself, kind: "sphere" }
const nearHalf: Placement = { ...itself, center: { x: 750, y: 1000, z: 250 }, half: { x: 250, y: 1000, z: 250 } }
const farHalf: Placement = { ...itself, center: { x: 250, y: 1000, z: 250 }, half: { x: 250, y: 1000, z: 250 } }

/** The view from +X, toward -X: the ninth. */
const FROM_X = 8
/** Pixels a cm in the default pictures. */
const scale = 256 / (2 * frame.radius)

describe("viewFrameOf", () => {
  it("is the sphere round the model's box", () => {
    assert.deepStrictEqual(frame.centre, [500, 1000, 250])
    assert.closeTo(frame.radius, Math.hypot(1000, 2000, 500) / 2, 1e-9)
  })
})

describe("picturesOf", () => {
  it("draws twelve views, each the size asked for", () => {
    assert.deepStrictEqual(views.pictures.map((picture) => picture.size), Array.from({ length: 12 }, () => 256))
    const small = picturesOf(frame, [block], { size: 32 })
    assert.lengthOf(small, 12)
    assert.lengthOf(small[0]?.mask ?? [], 32 * 32)
  })

  it("keeps the silhouette, the depth toward the camera and the face's direction", () => {
    const picture = views.pictures[FROM_X]
    assert.isDefined(picture)
    // From +X the block is 2000 cm by 500.
    assert.closeTo(countOf(picture.mask), 2000 * 500 * scale ** 2, 0.03 * 2000 * 500 * scale ** 2)
    const middle = 128 + 256 * 128
    assert.strictEqual(at(picture.mask, middle), 1)
    assert.closeTo(at(picture.depth, middle), 500, 1e-3)
    assert.deepStrictEqual([...picture.normals.subarray(3 * middle, 3 * middle + 3)], [1, 0, 0])
    assert.strictEqual(at(picture.mask, 0), 0)
    assert.strictEqual(at(picture.depth, 0), -Infinity)
  })

  it("shows the nearer of two surfaces, whichever is drawn first", () => {
    const near = trianglesOfPlacement(nearHalf), far = trianglesOfPlacement(farHalf)
    const middle = 128 + 256 * 128
    for (const sets of [[near, far], [far, near]]) {
      assert.closeTo(at(picturesOf(frame, sets)[FROM_X]?.depth ?? new Float32Array(), middle), 500, 1e-3)
    }
  })
})

describe("trianglesOfPlacement", () => {
  it("draws every kind where its inside test fills it, at any size and turn", () => {
    const grid = gridOver({ min: { x: -700, y: -700, z: -700 }, max: { x: 700, y: 700, z: 700 } }, 40)
    const rotation = quatFromAxisAngle({ x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }, 0.6)
    for (const kind of shapeKinds) {
      const placement = { kind, center: { x: 30, y: -20, z: 10 }, half: { x: 400, y: 500, z: 600 }, rotation }
      const drawn = voxelize(trianglesOfPlacement(placement), grid, { surface: false }).cells
      const filled = new Uint8Array(cellCount(grid))
      forEachCellIn(grid, toGridShape(grid, placement), (i) => {
        filled[i] = 1
      })
      let both = 0, either = 0
      for (let i = 0; i < filled.length; i++) {
        both += at(filled, i) & at(drawn, i)
        either += at(filled, i) | at(drawn, i)
      }
      // The round kinds are drawn with facets inside their true surface.
      assert.isAbove(both / either, 0.93, kind)
    }
  })
})

describe("drawnOver", () => {
  it("is the base with the pieces drawn in too, and leaves the base as it was", () => {
    const base = piecePictures(frame, [farHalf])
    const before = base.map((picture) => picture.depth.slice())
    assert.deepStrictEqual(drawnOver(frame, base, [nearHalf, ball]), piecePictures(frame, [farHalf, nearHalf, ball]))
    assert.deepStrictEqual(base.map((picture) => picture.depth), before)
  })
})

describe("regionsOf", () => {
  it("marks a square round each point in every view", () => {
    const radius = 10 / scale
    const regions = regionsOf(frame, Float64Array.of(...frame.centre), radius)
    assert.lengthOf(regions, 12)
    for (const region of regions) {
      assert.strictEqual(countOf(region), 21 * 21)
      assert.strictEqual(at(region, 128 + 256 * 128), 1)
      assert.strictEqual(at(region, 139 + 256 * 128), 0)
    }
  })
})

describe("edgesOf", () => {
  it("marks the outline, and where depth or face direction jumps", () => {
    const flat = views.pictures[FROM_X]
    assert.isDefined(flat)
    // Face on, the block shows its outline alone: about its perimeter in pixels.
    const outline = 2 * (2000 + 500) * scale
    assert.closeTo(countOf(edgesOf(flat, frame)), outline, 0.05 * outline)
    // From a corner three faces show, and the creases between them count.
    const corner = views.pictures[7]
    assert.isDefined(corner)
    const edges = edgesOf(corner, frame)
    let inner = 0
    for (let y = 1; y < 255; y++) {
      for (let x = 1; x < 255; x++) {
        const i = x + 256 * y
        const buried = [i - 1, i + 1, i - 256, i + 256, i + 257].every((j) => at(corner.mask, j) === 1)
        if (buried) inner += at(edges, i)
      }
    }
    assert.isAbove(inner, 100)
  })
})

describe("compareViews", () => {
  it("sees a box drawn as one cube as the box, and a sphere in its place as a worse match", () => {
    const same = compareViews(views, [itself])
    assert.isAbove(same.silhouette, 0.97)
    assert.isBelow(same.normalAngle, 1)
    assert.closeTo(same.clutter, 1, 0.1)
    const round = compareViews(views, [ball])
    assert.isBelow(round.silhouette, 0.9)
    assert.isAbove(round.normalAngle, 20)
  })

  it("counts a pile of small boxes in a box's place as cluttered", () => {
    const pile = Array.from({ length: 20 }, (_, i): Placement => ({
      kind: "box",
      center: { x: 500, y: 50 + 100 * i, z: 250 },
      half: { x: 500 - 15 * (i % 2), y: 50, z: 250 - 15 * (i % 2) },
      rotation: IDENTITY_QUAT
    }))
    assert.isAbove(compareViews(views, pile).clutter, 1.5)
  })

  it("measures nothing against nothing as no match of faces", () => {
    assert.deepStrictEqual(compareViews(views, []), { silhouette: 0, normalAngle: 90, clutter: 0 })
  })
})

describe("lookOf", () => {
  it("scores the model's own shape near 1, less of it lower, and nothing 0", () => {
    const same = lookOfPlacements(views, [itself])
    assert.isAbove(same.score, 0.97)
    assert.closeTo(same.score, (same.silhouette + same.depth + same.normal) / 3, 1e-12)
    const half = lookOfPlacements(views, [farHalf])
    assert.isBelow(half.score, same.score - 0.2)
    assert.isAbove(half.score, 0.2)
    assert.deepStrictEqual(lookOfPlacements(views, []), { silhouette: 0, depth: 0, normal: 0, score: 0 })
  })

  it("tells a surface in the wrong place or facing the wrong way from one that fills the same outline", () => {
    const same = lookOfPlacements(views, [itself])
    // The same outline from +X and -X, but its faces there sit 250 cm back.
    const thin = lookOfPlacements(views, [{ ...itself, half: { x: 250, y: 1000, z: 250 } }])
    assert.isBelow(thin.depth, same.depth - 0.05)
    const round = lookOfPlacements(views, [ball])
    assert.isBelow(round.normal, same.normal - 0.1)
  })

  it("reads pictures of any size against the model's, pooled to the same", () => {
    const large = lookOf(views, piecePictures(frame, [ball]))
    const small = lookOf(views, picturesOf(frame, [trianglesOfPlacement(ball)], { size: 128 }))
    assert.closeTo(small.score, large.score, 0.02)
  })

  it("judges the regions alone when given them", () => {
    // Round the far half's middle the far half is all there is to see from most sides; over the whole it is half.
    const pictures = piecePictures(frame, [farHalf])
    const regions = regionsOf(frame, Float64Array.of(100, 1000, 250), 150)
    assert.isAbove(lookOf(views, pictures, regions).silhouette, lookOf(views, pictures).silhouette + 0.2)
    const nowhere = regions.map((region) => new Uint8Array(region.length))
    assert.deepStrictEqual(lookOf(views, pictures, nowhere), { silhouette: 1, depth: 1, normal: 1, score: 1 })
  })
})
