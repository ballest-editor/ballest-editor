import { assert, describe, it } from "@effect/vitest"
import { boxAt, cubeAt, endAlongX, meshOfBox, topView } from "../test/snapFixtures"
import type { Vec3 } from "./coords"
import type { Box } from "./itemBounds"
import { defaultSnapConfig, type SnapConfig, type SnapTarget, withPreset, withTargetMoved } from "./snapConfig"
import type { BasePoint, SnapFrame, SnapHit, SnapItem, TrackedPoint } from "./snapFrame"
import { defaultSnapPrefs } from "./snapPrefs"
import { cornersOf, shownMarks } from "./snapRelation"
import { moveOf, resolveDrag, resolveSnap } from "./snapResolve"
import { meshHits, nearEndsOf } from "./snapTargets"
import { selectionBases } from "./snapTools"
import { IDENTITY_QUAT, ORIGIN, vecDot, vecSub } from "./ueMath"

const on = (config: SnapConfig, ...targets: ReadonlyArray<SnapTarget>): SnapConfig => {
  const turned = <T extends { readonly enabled: boolean }>(name: SnapTarget, target: T): T => ({
    ...target,
    enabled: targets.includes(name)
  })
  const { alignment, connectors, construction, grid, mesh, tracking } = config.targets
  return {
    ...config,
    enabled: true,
    targets: {
      grid: turned("grid", grid),
      connectors: turned("connectors", connectors),
      mesh: turned("mesh", mesh),
      construction: turned("construction", construction),
      tracking: turned("tracking", tracking),
      alignment: turned("alignment", alignment)
    }
  }
}

/** A plane square to X at `x`. */
const wall = (name: string, x: number) => ({
  kind: "plane" as const,
  id: "p",
  name,
  origin: { x, y: 0, z: 0 },
  normal: { x: 1, y: 0, z: 0 },
  xAxis: { x: 0, y: 1, z: 0 },
  extent: 1000,
  grid: false
})

const pivotBase: BasePoint = { start: ORIGIN, label: "Pivot" }

/** Two acquired points, whose lines along X and Y cross at (500, 700). */
const twoTracked: ReadonlyArray<TrackedPoint> = [
  { at: { x: 500, y: 0, z: 0 }, label: "Corner of Kicker" },
  { at: { x: 0, y: 700, z: 0 }, label: "Corner of Curve" }
]

/** A base that stops on faces across X, as a selection's near or far face does. */
const faceBase: BasePoint = { ...pivotBase, stop: { kind: "face", axis: { x: 1, y: 0, z: 0 } } }

/** An item with one end at x 300 facing back along X, a vertex at `vertex`, and a base that is an end facing it. */
const endWithVertex = (vertex: Vec3) => {
  const end = endAlongX("a", 0, 300, -1)
  const own: BasePoint = { start: ORIGIN, label: "End", end: endAlongX("own", 0, 0, 1) }
  const mesh = () => ({ vertices: [vertex], edges: [], faceCentres: [], faces: [] })
  return { end, own, items: [cubeAt("a", end.position, { ends: [end], mesh, bounds: undefined })] }
}

const frameOf = (offset: Vec3, extra: Partial<SnapFrame> = {}): SnapFrame => ({
  config: on(defaultSnapConfig, "grid", "mesh"),
  prefs: defaultSnapPrefs,
  view: topView(),
  items: [],
  constraint: { kind: "surface", normal: { x: 0, y: 0, z: 1 } },
  pointer: { x: offset.x, y: offset.y },
  offset,
  slip: { x: 0, y: 0 },
  bases: [pivotBase],
  box: boxAt(ORIGIN),
  rotation: IDENTITY_QUAT,
  units: "cm",
  tracked: [],
  construction: [],
  measurements: [],
  ...extra
})

describe("resolveSnap", () => {
  it("falls back to the grid when nothing is near, keeping the height of what slides", () => {
    const hit = resolveSnap(frameOf({ x: 137, y: 42, z: 0 }))
    assert.strictEqual(hit?.target, "grid")
    assert.deepStrictEqual(hit?.landing, { x: 140, y: 40, z: 0 })
    assert.strictEqual(hit?.label, "Grid 10 cm")
  })

  it("lets the first target with something in range win", () => {
    const config = withTargetMoved(on(defaultSnapConfig, "grid", "mesh"), "mesh", 0)
    const items = [cubeAt("a", { x: 200, y: 0, z: 0 })]
    const hit = resolveSnap(frameOf({ x: 146, y: 46, z: 0 }, { config, items }))
    assert.strictEqual(hit?.target, "mesh")
    assert.deepStrictEqual(hit?.landing, { x: 150, y: 50, z: 50 })
    assert.strictEqual(hit?.label, "Corner of Cube")
  })

  it("doesn't let a grid finer than the range shut out what is below it in the list", () => {
    const items = [cubeAt("a", { x: 200, y: 0, z: 0 })]
    const hit = resolveSnap(frameOf({ x: 146, y: 46, z: 0 }, { items }))
    assert.strictEqual(hit?.target, "mesh")
  })

  it("lets a grid coarser than the range win when it is first and near", () => {
    const config = { ...on(defaultSnapConfig, "grid", "mesh"), gridSize: 100 }
    const items = [cubeAt("a", { x: 200, y: 0, z: 0 })]
    assert.strictEqual(resolveSnap(frameOf({ x: 146, y: 46, z: 0 }, { config, items }))?.target, "mesh")
    const hit = resolveSnap(frameOf({ x: 104, y: 96, z: 0 }, { config, items }))
    assert.strictEqual(hit?.target, "grid")
    assert.deepStrictEqual(hit?.landing, { x: 100, y: 100, z: 0 })
  })

  describe("the connectors' pull", () => {
    const { end, items, own } = endWithVertex({ x: 306, y: 0, z: 0 })
    const pulled = (config: SnapConfig, weight: number): SnapConfig => ({
      ...config,
      targets: { ...config.targets, connectors: { ...config.targets.connectors, weight } }
    })
    const pick = (config: SnapConfig, x: number) =>
      resolveSnap(frameOf({ x, y: 0, z: 0 }, { config, bases: [own], items }))

    it("leaves a vertex above Connectors in the list to win at an even pull, and gives the end the frame above it", () => {
      const meshFirst = withTargetMoved(on(defaultSnapConfig, "grid", "connectors", "mesh"), "mesh", 0)
      assert.strictEqual(pick(meshFirst, 304)?.target, "mesh")
      assert.strictEqual(pick(pulled(meshFirst, 2), 304)?.target, "connectors")
      assert.strictEqual(pick(pulled(meshFirst, 0.5), 304)?.target, "mesh")
    })

    it("reaches an end from further off as it pulls harder, and from nearer as it pulls less", () => {
      const ends = on(defaultSnapConfig, "connectors")
      assert.isUndefined(pick(ends, 320))
      assert.deepStrictEqual(pick(pulled(ends, 2), 320)?.landing, end.position)
      assert.isUndefined(pick(pulled(ends, 0.5), 308))
      assert.deepStrictEqual(pick(ends, 308)?.landing, end.position)
    })
  })

  it("finds the ends of other items near the selection's on screen, whatever their depth or the way they face", () => {
    const own = { ...pivotBase, end: endAlongX("own", 0, 0, 1) }
    const ends = [endAlongX("a", 0, 60, 1), endAlongX("a", 1, 150, -1), {
      ...endAlongX("b", 0, 0, -1),
      position: { x: 0, y: 40, z: -900 }
    }]
    const items = [
      cubeAt("a", { x: 100, y: 0, z: 0 }, { ends: ends.slice(0, 2) }),
      cubeAt("b", { x: 0, y: 40, z: -900 }, { ends: ends.slice(2) })
    ]
    const near = nearEndsOf(frameOf({ x: 10, y: 0, z: 0 }, { bases: [own, pivotBase], items }), 60)
    assert.deepStrictEqual(near.map(({ ref }) => `${ref.item} ${ref.end}`).toSorted(), ["a 0", "b 0"])
  })

  it("doesn't turn a piece round to join an end its trailing end goes past", () => {
    const { end, items } = endWithVertex({ x: 0, y: 700, z: 0 })
    const ends = on(defaultSnapConfig, "connectors")
    const trailing: BasePoint = { start: ORIGIN, label: "End", end: endAlongX("own", 0, 0, -1) }
    const hit = resolveSnap(frameOf({ x: 304, y: 0, z: 0 }, { config: ends, bases: [trailing], items }))
    assert.isUndefined(hit, "the ends face the same way")
    const facing: BasePoint = { start: ORIGIN, label: "End", end: endAlongX("own", 0, 0, 1) }
    assert.deepStrictEqual(
      resolveSnap(frameOf({ x: 304, y: 0, z: 0 }, { config: ends, bases: [facing], items }))?.landing,
      end.position
    )
  })

  it("joins ends of another profile by your Profiles, and offers the flip by your Flip to fit", () => {
    const { items } = endWithVertex({ x: 0, y: 700, z: 0 })
    const ends = on(defaultSnapConfig, "connectors")
    const tube: BasePoint = { start: ORIGIN, label: "End", end: { ...endAlongX("own", 0, 0, 1), profile: "Tube F" } }
    const join = (prefs: Partial<typeof defaultSnapPrefs>) =>
      resolveSnap(
        frameOf({ x: 304, y: 0, z: 0 }, {
          config: ends,
          prefs: { ...defaultSnapPrefs, ...prefs },
          bases: [tube],
          items
        })
      )
    assert.strictEqual(join({})?.meeting?.warning, "Profiles differ: Tube F, Track")
    assert.isUndefined(join({ profiles: "strict" }))
    assert.isUndefined(join({ profiles: "any" })?.meeting?.warning)
    const lefty = (hand: "left" | "right") => ({ ...endAlongX("a", 0, 300, -1), hand })
    const handed = [cubeAt("a", { x: 300, y: 0, z: 0 }, { ends: [lefty("left")], bounds: undefined })]
    const own: BasePoint = { start: ORIGIN, label: "End", end: { ...endAlongX("own", 0, 0, 1), hand: "left" } }
    const flip = (flipToFit: boolean) =>
      resolveSnap(
        frameOf({ x: 304, y: 0, z: 0 }, {
          config: ends,
          prefs: { ...defaultSnapPrefs, flipToFit },
          bases: [own],
          items: handed
        })
      )?.meeting?.flipFits
    assert.isTrue(flip(true))
    assert.isUndefined(flip(false))
  })

  it("is free past every range with the grid off", () => {
    const config = on(defaultSnapConfig, "mesh")
    assert.isUndefined(resolveSnap(frameOf({ x: 500, y: 500, z: 0 }, { config, items: [cubeAt("a", ORIGIN)] })))
  })

  it("takes a point over an edge over a face, whatever the pixels", () => {
    const config = withPreset(on(defaultSnapConfig, "mesh"), "piecesFirst")
    const mesh = () => ({
      vertices: [{ x: 100, y: 0, z: 0 }],
      edges: [[{ x: 90, y: -100, z: 0 }, { x: 90, y: 100, z: 0 }] as const],
      faceCentres: [],
      faces: []
    })
    const items = [cubeAt("a", { x: 200, y: 200, z: 0 }, { mesh, box: boxAt({ x: 95, y: 0, z: 0 }, 200) })]
    assert.strictEqual(resolveSnap(frameOf({ x: 92, y: 0, z: 0 }, { config, items }))?.rank, 0)
    assert.strictEqual(resolveSnap(frameOf({ x: 92, y: 40, z: 0 }, { config, items }))?.rank, 1)
  })

  it("lands on a face under the pointer, with the offset along its normal", () => {
    const base = on(defaultSnapConfig, "mesh")
    const config = {
      ...base,
      targets: { ...base.targets, mesh: { ...base.targets.mesh, offset: 7, rotateToFace: "align" as const } }
    }
    const surfaceAt = () => ({
      point: { x: 300, y: 300, z: 20 },
      normal: { x: 1, y: 0, z: 0 },
      item: "a",
      corners: []
    })
    const hit = resolveSnap(frameOf({ x: 300, y: 300, z: 0 }, { config, surfaceAt }))
    assert.deepStrictEqual(hit?.landing, { x: 307, y: 300, z: 20 })
    assert.isDefined(hit?.rotation)
  })

  it("skips a point something hides, and takes it when the setting looks through pieces", () => {
    const base = on(defaultSnapConfig, "mesh")
    const items = [cubeAt("a", { x: 200, y: 0, z: 0 })]
    const occluded = () => true
    const surfaceAt = () => ({ point: { x: 150, y: 50, z: 80 }, normal: { x: 0, y: 0, z: 1 }, item: "b", corners: [] })
    const shown = resolveSnap(frameOf({ x: 150, y: 50, z: 0 }, { config: base, items, occluded, surfaceAt }))
    assert.strictEqual(shown?.rank, 2)
    assert.strictEqual(shown?.item, "b")
    const through = { ...defaultSnapPrefs, occlusion: "through" as const }
    assert.strictEqual(
      resolveSnap(frameOf({ x: 150, y: 50, z: 0 }, { config: base, prefs: through, items, occluded }))?.rank,
      0
    )
  })

  it("skips a bounds face something hides, and takes it when the setting looks through pieces", () => {
    const base = on(defaultSnapConfig, "mesh")
    const elements = Object.fromEntries(Object.keys(base.targets.mesh.elements).map((name) => [name, false]))
    const faces = { ...base.targets.mesh.elements, ...elements, boundsFaces: true }
    const front = { ...base, targets: { ...base.targets, mesh: { ...base.targets.mesh, elements: faces } } }
    const through = { ...defaultSnapPrefs, occlusion: "through" as const }
    const items = [cubeAt("a", { x: 200, y: 0, z: 0 })]
    const occluded = () => true
    const at = { x: 200, y: 0, z: 0 }
    assert.isUndefined(resolveSnap(frameOf(at, { config: front, items, occluded })))
    assert.strictEqual(resolveSnap(frameOf(at, { config: front, prefs: through, items, occluded }))?.item, "a")
    assert.strictEqual(resolveSnap(frameOf(at, { config: front, items, occluded: () => false }))?.item, "a")
  })

  it("only takes the value along a locked axis, with the target under the pointer", () => {
    const config = on(defaultSnapConfig, "mesh")
    const items = [cubeAt("a", { x: 200, y: 300, z: 0 })]
    const hit = resolveSnap(
      frameOf({ x: 150, y: 0, z: 0 }, {
        config,
        items,
        bases: [faceBase],
        constraint: { kind: "line", direction: { x: 1, y: 0, z: 0 } },
        slip: { x: 0, y: 250 }
      })
    )
    assert.deepStrictEqual(hit?.landing, { x: 150, y: 0, z: 0 })
  })

  it("doesn't pull a locked move to a face it would have to jump to", () => {
    const config = on(defaultSnapConfig, "mesh")
    const line = { kind: "line", direction: { x: 1, y: 0, z: 0 } } as const
    const slab = (from: number) => {
      const box = { min: { x: from, y: -50, z: -50 }, max: { x: 1000, y: 50, z: 50 } }
      return [cubeAt("a", ORIGIN, { box, mesh: () => meshOfBox(box) })]
    }
    const inside = { x: 150, y: 0, z: 0 }
    const reachedFrom = (from: number) =>
      resolveSnap(frameOf(inside, { config, bases: [faceBase], items: slab(from), constraint: line }))
    assert.isUndefined(reachedFrom(-900))
    assert.deepStrictEqual(reachedFrom(155)?.landing, { x: 155, y: 0, z: 0 })
  })

  it("picks the base nearest its target with Closest", () => {
    const config = on(defaultSnapConfig, "mesh")
    const bases: ReadonlyArray<BasePoint> = [
      { start: { x: -50, y: 0, z: 0 }, label: "Corner" },
      { start: { x: 50, y: 0, z: 0 }, label: "Corner" }
    ]
    const hit = resolveSnap(
      frameOf({ x: 98, y: 50, z: 0 }, { config, bases, items: [cubeAt("a", { x: 200, y: 0, z: 0 })] })
    )
    assert.deepStrictEqual(hit?.base.start, bases[1]?.start)
    const move = hit === undefined ? undefined : moveOf(hit)
    assert.deepStrictEqual(move?.offset, { x: 100, y: 50, z: 50 })
  })

  it("holds a target it was given, sliding along it past any range", () => {
    const edge = [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }] as const
    const held = {
      target: "mesh" as const,
      rank: 1 as const,
      distance: 0,
      base: pivotBase,
      landing: edge[0],
      label: "Edge of Cube",
      relation: "onEdge" as const,
      marks: [],
      source: [],
      held: { shape: "segment" as const, from: edge[0], to: edge[1] }
    }
    const hit = resolveSnap(frameOf({ x: 600, y: 300, z: 0 }), held)
    assert.deepStrictEqual(hit?.landing, { x: 600, y: 0, z: 0 })
    assert.strictEqual(hit?.label, "Edge of Cube")
  })

  it("snaps to a tracking line through an acquired point, and to where two cross", () => {
    const config = on(defaultSnapConfig, "tracking")
    const tracked = twoTracked
    const line = resolveSnap(frameOf({ x: 503, y: 300, z: 0 }, { config, tracked }))
    assert.strictEqual(line?.rank, 1)
    assert.closeTo(line?.landing.x ?? 0, 500, 1e-6)
    const cross = resolveSnap(frameOf({ x: 504, y: 696, z: 0 }, { config, tracked }))
    assert.strictEqual(cross?.rank, 0)
    assert.deepStrictEqual(cross?.landing, { x: 500, y: 700, z: 0 })
  })

  it("offers the line along the view through an acquired point, which keeps the base's depth", () => {
    const config = on(defaultSnapConfig, "tracking")
    const tracked = [{ at: { x: 500, y: 200, z: 900 }, label: "Corner of Kicker" }]
    const hit = resolveSnap(frameOf({ x: 504, y: 197, z: 0 }, { config, tracked }))
    assert.deepStrictEqual(hit?.landing, { x: 500, y: 200, z: 0 })
  })

  it("lands on a construction plane by gravity, and on its grid when it has one", () => {
    const config = on(defaultSnapConfig, "construction")
    const plane = wall("Landing", 0)
    const hit = resolveSnap(frameOf({ x: 5, y: 33, z: 0 }, { config, construction: [plane] }))
    assert.deepStrictEqual(hit?.landing, { x: 0, y: 33, z: 0 })
    assert.strictEqual(hit?.label, "Plane: Landing")
    const gridded = resolveSnap(frameOf({ x: 5, y: 33, z: 0 }, { config, construction: [{ ...plane, grid: true }] }))
    assert.deepStrictEqual(gridded?.landing, { x: 0, y: 30, z: 0 })
  })

  it("treats where an axis crosses a plane as a point", () => {
    const config = on(defaultSnapConfig, "construction")
    const construction = [
      wall("Floor", 300),
      {
        kind: "axis" as const,
        id: "a",
        name: "Spine",
        origin: { x: 0, y: 200, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        extent: 1000
      }
    ]
    const hit = resolveSnap(frameOf({ x: 298, y: 202, z: 0 }, { config, construction }))
    assert.strictEqual(hit?.rank, 0)
    assert.deepStrictEqual(hit?.landing, { x: 300, y: 200, z: 0 })
  })

  it("makes a measurement's ends targets", () => {
    const config = on(defaultSnapConfig, "construction")
    const measurements = [{ id: "m", a: { x: 100, y: 0, z: 0 }, b: { x: 400, y: 0, z: 0 } }]
    assert.deepStrictEqual(
      resolveSnap(frameOf({ x: 396, y: 3, z: 0 }, { config, measurements }))?.landing,
      { x: 400, y: 0, z: 0 }
    )
  })
})

describe("the Mesh target under a move's constraint", () => {
  const X = { x: 1, y: 0, z: 0 }
  const line = { kind: "line", direction: X } as const
  const plane = { kind: "plane", normal: { x: 0, y: 0, z: 1 } } as const
  const config = on(defaultSnapConfig, "mesh")
  const at = { x: 300, y: 0, z: 0 }
  const meshed = cubeAt("a", at, { mesh: () => meshOfBox(boxAt(at)) })
  const unloaded = cubeAt("a", at)
  /** The bases of a selection with no size, whose faces and centre are one point: it stops at all a station offers. */
  const noSize = (constraint: SnapFrame["constraint"]) =>
    selectionBases(config, { pivot: ORIGIN, box: { min: ORIGIN, max: ORIGIN }, ends: [] }, constraint)
  /** What the item offers a base in its middle, in a pane where the whole cube is in range. */
  const offered = (item: typeof meshed, constraint: SnapFrame["constraint"], bases = noSize(constraint)) =>
    meshHits(frameOf(at, { config, view: topView(10), items: [item], bases, constraint }))
  const labels = (hits: ReadonlyArray<{ readonly label: string }>) =>
    [...new Set(hits.map(({ label }) => label))].sort()
  const planes = (hits: ReadonlyArray<SnapHit>) => hits.flatMap(({ held }) => held.shape === "plane" ? [held] : [])

  it("offers the faces along a line and the plane between them, the face centres only on a plane, and no vertex", () => {
    assert.deepStrictEqual(labels(offered(meshed, line)), ["Face of Cube", "Middle of Cube"])
    assert.include(labels(offered(meshed, plane)), "Center of a face of Cube")
    const hits = offered(meshed, line)
    const stops = hits.filter(({ rank }) => rank === 2).map(({ landing }) => landing.x).toSorted((a, b) => a - b)
    assert.deepStrictEqual(stops, [250, 300, 350])
    assert.deepStrictEqual(planes(hits)[0], {
      shape: "plane",
      origin: { x: 250, y: 0, z: 0 },
      normal: { x: -1, y: 0, z: 0 }
    })
    assert.lengthOf(offered(meshed, plane).filter(({ base, rank }) => rank === 0 && base.label === "Pivot"), 6)
  })

  it("offers vertices, edges and midpoints to a surface drag, and no stations", () => {
    const names = labels(offered(meshed, { kind: "surface", normal: { x: 0, y: 0, z: 1 } }))
    assert.includeMembers(names, ["Vertex of Cube", "Edge of Cube", "Middle of an edge of Cube"])
    assert.notInclude(names, "Middle of Cube")
  })

  it("offers the faces along both of a plane's axes, and leaves the other value alone", () => {
    const sized = selectionBases(config, { pivot: ORIGIN, box: boxAt(ORIGIN, 1), ends: [] }, plane)
    const hits = planes(offered(meshed, plane, sized))
    const normals = hits.map(({ normal }) => [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].join())
    assert.deepStrictEqual([...new Set(normals)].sort(), ["0,1,0", "1,0,0"])
    const free = { x: 345, y: 20, z: 0 }
    const landing = resolveSnap(frameOf(free, { config, bases: [faceBase], items: [meshed], constraint: plane }))
      ?.landing
    assert.deepStrictEqual(landing, { x: 350, y: 20, z: 0 })
  })

  it("counts a face a few degrees off the move, and lands where the move crosses it", () => {
    const turn = 3 * Math.PI / 180
    const normal = { x: Math.cos(turn), y: Math.sin(turn), z: 0 }
    const tilted = (n: Vec3) => ({
      ...meshOfBox(boxAt(at)),
      faces: [{ centre: { x: 340, y: 100, z: 0 }, normal: n, corners: [] }]
    })
    const hit = (n: Vec3) =>
      meshHits(
        frameOf(at, {
          config,
          bases: [faceBase],
          items: [{ ...meshed, mesh: () => tilted(n) }],
          view: topView(10),
          constraint: line
        })
      )
        .find(({ label }) => label === "Face of Cube")
    assert.closeTo(hit(normal)?.landing.x ?? 0, 340 + 100 * Math.tan(turn), 1e-6)
    assert.isUndefined(hit({ x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }))
  })

  it("keeps a face's Offset, and leaves it off the middle", () => {
    const mesh = { ...config.targets.mesh, offset: 7 }
    const offset = { ...config, targets: { ...config.targets, mesh } }
    const bases = noSize(line)
    const hits = meshHits(frameOf(at, { config: offset, view: topView(10), items: [meshed], bases, constraint: line }))
    const stops = hits.filter(({ rank }) => rank === 2).map(({ landing }) => landing.x).toSorted((a, b) => a - b)
    assert.deepStrictEqual(stops, [243, 300, 357])
  })

  it("stops at a station something hides, as the move doesn't look at it", () => {
    const hit = resolveSnap(
      frameOf({ x: 345, y: 0, z: 0 }, {
        config,
        bases: [faceBase],
        items: [meshed],
        constraint: line,
        occluded: () => true
      })
    )
    assert.deepStrictEqual(hit?.landing, { x: 350, y: 0, z: 0 })
  })

  it("lets bounds stand in only for an item with no mesh", () => {
    const surface = { kind: "surface", normal: { x: 0, y: 0, z: 1 } } as const
    assert.includeMembers(labels(offered(unloaded, surface)), ["Corner of Cube", "Face of Cube"])
    assert.notInclude(labels(offered(meshed, surface)), "Corner of Cube")
    assert.notInclude(labels(offered(meshed, surface)), "Face of Cube")
    assert.deepStrictEqual(labels(offered(unloaded, line)), ["Face of Cube", "Middle of Cube"])
    assert.include(labels(offered(unloaded, plane)), "Center of a face of Cube")
  })

  it("leaves the faces and the centres to their own toggles, by what stands in", () => {
    const { elements } = config.targets.mesh
    const without = (off: Partial<typeof elements>) => ({
      ...config,
      targets: { ...config.targets, mesh: { ...config.targets.mesh, elements: { ...elements, ...off } } }
    })
    const hitsOf = (item: typeof meshed, off: Partial<typeof elements>) =>
      labels(meshHits(frameOf(at, {
        config: without(off),
        view: topView(10),
        items: [item],
        bases: noSize(line),
        constraint: line
      })))
    // a face's centre is a point for a plane handle; under a line it would only be one more middle
    assert.deepStrictEqual(hitsOf(meshed, { faces: false }), [])
    assert.deepStrictEqual(hitsOf(meshed, { faceCentres: false }), ["Face of Cube", "Middle of Cube"])
    assert.deepStrictEqual(hitsOf(unloaded, { boundsFaces: false }), [])
    assert.deepStrictEqual(hitsOf(unloaded, { boundsFaceCentres: false }), ["Face of Cube", "Middle of Cube"])
  })

  describe("moving a 500 cm piece through a 1000 cm one", () => {
    const box = { min: { x: -250, y: -50, z: -50 }, max: { x: 250, y: 50, z: 50 } }
    const long = { min: { x: 1500, y: -50, z: -50 }, max: { x: 2500, y: 50, z: 50 } }
    const items = [cubeAt("a", ORIGIN, { box: long, mesh: () => meshOfBox(long) })]
    const noCentres = (from: SnapConfig): SnapConfig => {
      const { mesh } = from.targets
      return {
        ...from,
        targets: { ...from.targets, mesh: { ...mesh, elements: { ...mesh.elements, faceCentres: false } } }
      }
    }
    /** Where the move stops along a locked X, with the base that stopped it. */
    const stopsOf = (over: SnapConfig, bases: ReadonlyArray<BasePoint>) => {
      let from: Vec3 = ORIGIN
      let current: ReturnType<typeof resolveDrag>
      const stops = new Map<number, string>()
      for (let x = 1200; x < 2800; x += 4) {
        const offset = { x, y: 0, z: 0 }
        current = resolveDrag(frameOf(offset, { config: over, box, bases, items, constraint: line }), { from, current })
        from = offset
        if (current !== undefined) stops.set(moveOf(current).offset.x, current.base.label)
      }
      return [...stops]
    }

    it("touches, lies flush, centres, lies flush and touches", () => {
      const centred = { ...config, base: "centre" as const }
      const bases = selectionBases(centred, { pivot: { x: 0, y: 0, z: -50 }, box, ends: [] }, line)
      assert.deepStrictEqual(stopsOf(centred, bases), [
        [1250, "Far face"],
        [1750, "Near face"],
        [2000, "Center"],
        [2250, "Far face"],
        [2750, "Near face"]
      ])
    })

    it("stops the same five times when it moves by its ends", () => {
      const withEnds = on(defaultSnapConfig, "mesh", "connectors")
      const onTop = (x: number, facing: 1 | -1) => ({ ...endAlongX("own", 0, x, facing), position: { x, y: 0, z: 50 } })
      const ends = [onTop(250, 1), onTop(-250, -1)]
      const bases = selectionBases(withEnds, { pivot: { x: 0, y: 0, z: -50 }, box, ends }, line)
      assert.deepStrictEqual(stopsOf(withEnds, bases).map(([x]) => x), [1250, 1750, 2000, 2250, 2750])
    })

    it("doesn't stop the centre on a face, or a face on the middle", () => {
      const centre: BasePoint = { ...pivotBase, stop: { kind: "centre" } }
      assert.deepStrictEqual(stopsOf(config, [centre]), [[2000, "Pivot"]])
      assert.deepStrictEqual(stopsOf(noCentres(config), [faceBase]).map(([x]) => x), [1500, 2500])
    })

    it("doesn't stop the pivot at all", () => {
      assert.deepStrictEqual(stopsOf(noCentres(config), [pivotBase]), [])
    })

    it("stops a face on a plane handle only along the axis it's a face of", () => {
      const across = { x: 0, y: 1, z: 0 }
      const near: BasePoint = { ...pivotBase, stop: { kind: "face", axis: across } }
      const free = { x: 1503, y: 0, z: 0 }
      const onPlane = (bases: ReadonlyArray<BasePoint>) =>
        resolveSnap(frameOf(free, { config: noCentres(config), bases, items, constraint: plane }))?.landing.x
      assert.isUndefined(onPlane([near]))
      assert.strictEqual(onPlane([faceBase]), 1500)
    })
  })

  describe("on a plane, along both of its axes", () => {
    const named = (key: string, name: string, box: Box) =>
      cubeAt(key, ORIGIN, { name, box, mesh: () => meshOfBox(box) })
    /** Its face across X is at 400, for the far face of a selection moved 350. */
    const track = named("a", "Track Large", { min: { x: 400, y: -1000, z: -50 }, max: { x: 600, y: 1000, z: 50 } })
    /** Its face across Y is at 300, for the far face of a selection moved 250. */
    const curve = named("b", "Curve Large", { min: { x: -1000, y: 300, z: -50 }, max: { x: 1000, y: 500, z: 50 } })
    const bases = selectionBases(config, { pivot: ORIGIN, box: boxAt(ORIGIN), ends: [] }, plane)

    /** The hits of a drag through `path`, from its first point. */
    const dragThrough = (
      path: ReadonlyArray<readonly [number, number]>,
      items: ReadonlyArray<SnapItem>,
      over = config
    ) => {
      let from: Vec3 = { x: path[0]?.[0] ?? 0, y: path[0]?.[1] ?? 0, z: 0 }
      let current: ReturnType<typeof resolveDrag>
      return path.map(([x, y]) => {
        const offset = { x, y, z: 0 }
        current = resolveDrag(frameOf(offset, { config: over, bases, items, constraint: plane }), { from, current })
        from = offset
        return current
      })
    }
    const moves = (hits: ReadonlyArray<SnapHit | undefined>) =>
      hits.map((hit) => {
        if (hit === undefined) return undefined
        const { x, y } = moveOf(hit).offset
        return [x, y]
      })
    const reachesBoth = [[340, 240], [352, 240], [352, 252]] as const

    it("lands where a face across X and a face across Y cross, showing both", () => {
      const hit = dragThrough(reachesBoth, [track, curve]).at(-1)
      assert.deepStrictEqual(hit === undefined ? undefined : moveOf(hit).offset, { x: 350, y: 250, z: 0 })
      assert.strictEqual(hit?.label, "Face of Track Large and Face of Curve Large")
      assert.deepStrictEqual(hit?.held, { shape: "point", at: hit?.landing ?? ORIGIN })
      // each item's box with its face that stopped the move
      assert.deepStrictEqual(hit?.marks.map(({ kind }) => kind), ["box", "face", "box", "face"])
      assert.deepStrictEqual(hit?.parts?.map(({ item }) => item), ["a", "b"])
      const otherWay = dragThrough([[340, 240], [340, 252], [352, 252]], [track, curve]).at(-1)
      assert.deepStrictEqual(otherWay?.landing, hit?.landing)
      assert.strictEqual(otherWay?.label, hit?.label, "whichever axis it reaches first")
    })

    it("lands on a face across one axis and lines up across the other, the two targets together", () => {
      // a cube whose centre is level with the selection's once it has moved 250 along Y, beside it and out of Mesh's range
      const beside = cubeAt("c", { x: 100, y: 250, z: 0 }, { name: "Cube" })
      const hits = dragThrough(
        [...reachesBoth, [352, 270]],
        [track, beside],
        on(defaultSnapConfig, "mesh", "alignment")
      )
      // past the alignment's range the face still holds X, and Y goes free
      assert.deepStrictEqual(moves(hits.slice(-1)), [[350, 270]])
      const hit = hits.at(-2)
      assert.deepStrictEqual(hit === undefined ? undefined : moveOf(hit).offset, { x: 350, y: 250, z: 0 })
      assert.deepStrictEqual(hit?.parts?.map(({ target }) => target), ["mesh", "alignment"])
      assert.strictEqual(hit?.label, "Face of Track Large and Center level with Cube on Y")
      // both sides of each: the track's face and the cube's centre, each in its box
      const shown = hit === undefined ? [] : shownMarks(hit).filter((mark) => "role" in mark && mark.role === "target")
      assert.deepStrictEqual(shown.map(({ kind }) => kind), ["box", "face", "box", "dot"])
    })

    it("holds both while each is in its own range, and frees only the axis it leaves", () => {
      const hits = dragThrough([...reachesBoth, [360, 260], [360, 270], [375, 270]], [track, curve])
      assert.deepStrictEqual(moves(hits), [undefined, [350, 240], [350, 250], [350, 250], [350, 270], undefined])
      assert.strictEqual(hits[4]?.label, "Face of Track Large")
      assert.isUndefined(hits[4]?.parts)
    })

    it("names a face and a middle of one item once, and two faces of it as one", () => {
      const box = { min: { x: 400, y: -100, z: -50 }, max: { x: 600, y: 100, z: 50 } }
      // the far face centred on the item is on that face's centre, a point, which beats them with its toggle on
      const { mesh } = config.targets
      const elements = { ...mesh.elements, faceCentres: false }
      const noCentres = { ...config, targets: { ...config.targets, mesh: { ...mesh, elements } } }
      const middle = dragThrough([[340, -6], [352, -6], [352, 3]], [named("a", "Track Large", box)], noCentres).at(-1)
      assert.strictEqual(middle?.label, "Face and Middle of Track Large")
      const corner = dragThrough([[340, 40], [352, 40], [352, 52]], [named("a", "Track Large", box)]).at(-1)
      assert.strictEqual(corner?.label, "Face of Track Large")
      // two faces of one box, which is drawn once
      const drawn = corner === undefined
        ? []
        : shownMarks(corner).filter((mark) => "role" in mark && mark.role === "target")
      assert.deepStrictEqual(drawn.map(({ kind }) => kind), ["box", "face", "face"])
    })

    it("lands on both planes when a face stands a few degrees off the axis", () => {
      const turn = 3 * Math.PI / 180
      const normal = { x: -Math.cos(turn), y: Math.sin(turn), z: 0 }
      const centre = { x: 400, y: 0, z: 0 }
      const tilted = {
        ...track,
        mesh: () => ({ ...meshOfBox(track.box), faces: [{ centre, normal, corners: [] }] })
      }
      const hit = dragThrough([[355, 240], [365, 240], [365, 252]], [tilted, curve]).at(-1)
      const offset = hit === undefined ? ORIGIN : moveOf(hit).offset
      assert.closeTo(offset.y, 250, 1e-6)
      assert.closeTo(vecDot(vecSub({ x: 50 + offset.x, y: offset.y, z: 0 }, centre), normal), 0, 1e-6)
    })

    it("takes no turn, as none faces both, where one face alone takes its own", () => {
      const { mesh } = config.targets
      const turning = {
        ...config,
        targets: { ...config.targets, mesh: { ...mesh, rotateToFace: "upright" as const } }
      }
      const hits = dragThrough(reachesBoth, [track, curve], turning)
      assert.isDefined(hits[1]?.rotation)
      assert.isUndefined(hits[2]?.rotation)
    })
  })

  it("leaves the grid with the base the setting names, however near a station is", () => {
    const bases = selectionBases(on(defaultSnapConfig, "grid"), {
      pivot: { x: 3, y: 0, z: 0 },
      box: { min: { x: -500, y: -50, z: -50 }, max: { x: 500, y: 50, z: 50 } },
      ends: []
    }, line)
    const hit = resolveSnap(
      frameOf({ x: 100, y: 0, z: 0 }, {
        config: on(defaultSnapConfig, "grid"),
        bases,
        constraint: line,
        pointer: { x: 600, y: 0 }
      })
    )
    assert.strictEqual(hit?.base.label, "Pivot")
    assert.strictEqual(hit?.landing.x, 100)
  })
})

describe("resolveDrag", () => {
  const X = { x: 1, y: 0, z: 0 }
  const line = { kind: "line", direction: X } as const
  const measured = (x: number) => [{ id: "m", a: { x, y: 0, z: 0 }, b: { x, y: 900, z: 0 } }]
  const only = (...targets: ReadonlyArray<SnapTarget>) => on(defaultSnapConfig, ...targets)

  /** The hits of a drag through `xs` along X. */
  const dragAlong = (xs: ReadonlyArray<number>, extra: Partial<SnapFrame>, y = 0) => {
    let from: Vec3 = { x: 0, y, z: 0 }
    let current: ReturnType<typeof resolveDrag>
    return xs.map((x) => {
      const offset = { x, y, z: 0 }
      current = resolveDrag(frameOf(offset, extra), { from, current })
      from = offset
      return current
    })
  }

  it("takes a face under the base at once, as it has nothing to jump across", () => {
    const surfaceAt = () => ({ point: { x: 300, y: 300, z: 20 }, normal: { x: 0, y: 0, z: 1 }, item: "a", corners: [] })
    const config = only("mesh")
    const view = topView(1, { orthographic: false })
    const hit = resolveDrag(frameOf({ x: 300, y: 300, z: 0 }, { config, view, surfaceAt }), {
      from: ORIGIN,
      current: undefined
    })
    assert.deepStrictEqual(hit?.landing, { x: 300, y: 300, z: 20 })
  })

  it("stops a locked move at a face in reach only once the move gets there", () => {
    const box = { min: { x: 155, y: -50, z: -50 }, max: { x: 1000, y: 50, z: 50 } }
    const items = [cubeAt("a", ORIGIN, { box, mesh: () => meshOfBox(box) })]
    const hits = dragAlong([100, 150, 154, 156, 164, 168], {
      config: only("mesh"),
      bases: [faceBase],
      items,
      constraint: line
    })
    assert.deepStrictEqual(hits.map((hit) => hit?.landing.x), [undefined, undefined, 155, 155, 155, undefined])
  })

  it("stops on a plane where the move crosses it, and goes free past the range", () => {
    const hits = dragAlong([280, 290, 301, 310, 313], {
      config: only("construction"),
      construction: [wall("Wall", 300)]
    })
    assert.deepStrictEqual(hits.map((hit) => hit?.landing.x), [undefined, undefined, 300, 300, undefined])
  })

  it("doesn't let a target above in the list take over by being in range, only by being reached", () => {
    const config = withTargetMoved(only("construction", "tracking"), "construction", 0)
    const tracked = [{ at: { x: 200, y: 900, z: 0 }, label: "Corner of Kicker" }]
    const hits = dragAlong([195, 201, 203, 207], { config, tracked, measurements: measured(206) })
    assert.deepStrictEqual(hits.map((hit) => hit?.landing.x), [undefined, 200, 200, 206])
    assert.strictEqual(hits[3]?.target, "construction")
  })

  it("drops a tracking line along a locked move, and keeps the lines across it", () => {
    const config = only("tracking")
    const tracked = [{ at: { x: 500, y: 0, z: 0 }, label: "End of Track L" }]
    const hits = dragAlong([100, 200, 300, 495, 503], { config, tracked, constraint: line })
    assert.deepStrictEqual(hits.map((hit) => hit?.landing.x), [undefined, undefined, undefined, undefined, 500])
    const turn = 0.5 * Math.PI / 180
    const nearly = { kind: "line", direction: { x: Math.cos(turn), y: Math.sin(turn), z: 0 } } as const
    const offset = { x: 300 * nearly.direction.x, y: 300 * nearly.direction.y, z: 0 }
    assert.isUndefined(
      resolveDrag(frameOf(offset, { config, tracked, constraint: nearly }), { from: ORIGIN, current: undefined }),
      "half a degree off is along it"
    )
  })

  it("keeps tracking lines along the plane of a plane lock", () => {
    const config = only("tracking")
    const tracked = [{ at: { x: 500, y: 0, z: 0 }, label: "End of Track L" }]
    const constraint = { kind: "plane", normal: { x: 0, y: 0, z: 1 } } as const
    const hit = resolveDrag(frameOf({ x: 300, y: 1, z: 0 }, { config, tracked, constraint }), {
      from: { x: 300, y: -6, z: 0 },
      current: undefined
    })
    assert.strictEqual(hit?.label, "In line with End of Track L")
  })

  it("reaches an end the path passes anywhere in its range, and a vertex only within a third", () => {
    const { end, items, own } = endWithVertex({ x: 300, y: 0, z: 0 })
    const path = [280, 296, 304]
    const passing = (config: SnapConfig, y: number) => dragAlong(path, { config, bases: [own], items }, y)[2]?.landing
    assert.deepStrictEqual(passing(only("connectors"), 8), end.position)
    assert.isUndefined(passing(only("mesh"), 8))
    assert.deepStrictEqual(passing(only("mesh"), 3), end.position)
  })

  it("takes a point on the edge it's sliding along", () => {
    const edge = [{ x: -500, y: 0, z: 0 }, { x: 500, y: 0, z: 0 }] as const
    const mesh = () => ({ vertices: [{ x: 300, y: 0, z: 0 }], edges: [edge], faceCentres: [], faces: [] })
    const items = [cubeAt("a", { x: 0, y: 0, z: 0 }, { mesh, box: boxAt(ORIGIN, 600), bounds: undefined })]
    const config = only("mesh")
    const slide = (x: number, from: Vec3, current?: ReturnType<typeof resolveDrag>) =>
      resolveDrag(frameOf({ x, y: 5, z: 0 }, { config, items }), { from, current })
    const start = { x: 100, y: -5, z: 0 }
    const onEdge = slide(100, start)
    assert.strictEqual(onEdge?.rank, 1)
    const stillOn = slide(280, { x: 100, y: 5, z: 0 }, onEdge)
    assert.strictEqual(stillOn?.rank, 1)
    assert.strictEqual(slide(301, { x: 280, y: 5, z: 0 }, stillOn)?.rank, 0)
  })

  it("stops each axis of an alignment as the move gets to it, and keeps both", () => {
    const config = only("alignment")
    const items = [cubeAt("a", { x: 400, y: 400, z: 0 })]
    const first = resolveDrag(frameOf({ x: 401, y: 391, z: 0 }, { config, items }), {
      from: { x: 396, y: 390, z: 0 },
      current: undefined
    })
    assert.closeTo(first?.landing.x ?? 0, 400, 1e-6)
    assert.closeTo(first?.landing.y ?? 0, 391, 1e-6)
    const second = resolveDrag(frameOf({ x: 402, y: 401, z: 0 }, { config, items }), {
      from: { x: 401, y: 391, z: 0 },
      current: first
    })
    assert.closeTo(second?.landing.x ?? 0, 400, 1e-6)
    assert.closeTo(second?.landing.y ?? 0, 400, 1e-6)
    const kept = resolveDrag(frameOf({ x: 403, y: 402, z: 0 }, { config, items }), {
      from: { x: 402, y: 401, z: 0 },
      current: second
    })
    assert.closeTo(kept?.landing.x ?? 0, 400, 1e-6)
    assert.closeTo(kept?.landing.y ?? 0, 400, 1e-6)
  })

  it("leaves a coarse grid first in the list to claim a frame as it does", () => {
    const config = { ...only("grid", "construction"), gridSize: 100 }
    const hits = dragAlong([195], { config, construction: [wall("Wall", 300)] })
    assert.strictEqual(hits[0]?.target, "grid")
    assert.strictEqual(hits[0]?.landing.x, 200)
  })
})

describe("a body drag in an orthographic pane", () => {
  const config = on(defaultSnapConfig, "mesh")
  const high = { x: 300, y: 0, z: 100 }
  const own: BasePoint = { start: { x: 0, y: 0, z: 40 }, label: "Pivot" }
  const mesh = () => ({ vertices: [high], edges: [], faceCentres: [], faces: [] })
  const items = [cubeAt("a", high, { mesh, bounds: undefined })]
  const facing = (normal: Vec3) => () => ({ point: high, normal, item: "a", corners: [] })
  const path = { from: { x: 299, y: 0, z: 0 }, current: undefined }
  const atVertex = { x: 300, y: 0, z: 0 }

  it("takes the two values across the view from a point, and keeps the base's depth", () => {
    const frame = frameOf(atVertex, { config, items, bases: [own] })
    const hit = resolveDrag(frame, path)
    assert.deepStrictEqual(hit?.landing, { x: 300, y: 0, z: 40 })
    assert.deepStrictEqual(hit === undefined ? undefined : resolveSnap(frame, hit)?.landing, hit?.landing, "held")
  })

  it("keeps the depth on an edge and on a tracking line", () => {
    const edge = [{ x: 300, y: -500, z: 100 }, { x: 300, y: 500, z: 100 }] as const
    const onEdge = [cubeAt("a", high, {
      box: boxAt(high, 600),
      bounds: undefined,
      mesh: () => ({ vertices: [], edges: [edge], faceCentres: [], faces: [] })
    })]
    assert.strictEqual(
      resolveDrag(frameOf({ x: 303, y: 20, z: 0 }, { config, items: onEdge, bases: [own] }), {
        from: { x: 297, y: 20, z: 0 },
        current: undefined
      })?.landing.z,
      40
    )
    const tracked = [{ at: { x: 300, y: 900, z: 100 }, label: "Corner of Kicker" }]
    assert.strictEqual(
      resolveDrag(frameOf({ x: 303, y: 20, z: 0 }, { config: on(config, "tracking"), tracked, bases: [own] }), {
        from: { x: 297, y: 20, z: 0 },
        current: undefined
      })?.landing.z,
      40
    )
  })

  it("doesn't offer a face looking at the pane, and offers it in perspective", () => {
    const up = facing({ x: 0, y: 0, z: 1 })
    const nearly = facing({ x: Math.sin(0.05), y: 0, z: Math.cos(0.05) })
    assert.isUndefined(resolveDrag(frameOf(atVertex, { config, surfaceAt: up }), path))
    assert.isUndefined(resolveDrag(frameOf(atVertex, { config, surfaceAt: nearly }), path))
    const view = topView(1, { orthographic: false })
    assert.deepStrictEqual(resolveDrag(frameOf(atVertex, { config, view, surfaceAt: up }), path)?.landing, high)
  })

  it("slides along a face seen edge-on, at the base's own depth", () => {
    const surfaceAt = facing({ x: 1, y: 0, z: 0 })
    const hit = resolveDrag(frameOf(atVertex, { config, surfaceAt, bases: [own] }), path)
    assert.deepStrictEqual(hit?.landing, { x: 300, y: 0, z: 40 })
  })

  it("lands on a sloped face at its height, as the slope is what's meant", () => {
    const surfaceAt = facing({ x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 })
    assert.deepStrictEqual(resolveDrag(frameOf(atVertex, { config, surfaceAt, bases: [own] }), path)?.landing, high)
  })

  it("joins an end at its height, as a join is the ends meeting", () => {
    const end = { ...endAlongX("a", 0, 300, -1), position: high }
    const joining: BasePoint = { ...own, end: endAlongX("own", 0, 0, 1) }
    const frame = frameOf(atVertex, {
      config: on(defaultSnapConfig, "connectors"),
      items: [cubeAt("a", high, { ends: [end] })],
      bases: [joining]
    })
    assert.deepStrictEqual(resolveDrag(frame, path)?.landing, high)
  })

  it("leaves a pick and a drop what they point at, as they have no depth of their own", () => {
    assert.deepStrictEqual(resolveSnap(frameOf(atVertex, { config, items, bases: [own] }))?.landing, high)
    const surfaceAt = facing({ x: 0, y: 0, z: 1 })
    assert.deepStrictEqual(resolveSnap(frameOf(atVertex, { config, surfaceAt, bases: [own] }))?.landing, high)
  })
})

describe("what a hit shows: the kind of snap, the part of the selection that landed, and what it landed on", () => {
  const X = { x: 1, y: 0, z: 0 }
  const line = { kind: "line", direction: X } as const
  /** The hit's marks of one role, by kind. */
  const roles = (hit: SnapHit | undefined, role: "source" | "target") =>
    (hit === undefined ? [] : shownMarks(hit)).flatMap((mark) => "role" in mark && mark.role === role ? [mark] : [])
  const glyphOf = (hit: SnapHit | undefined) => (hit === undefined ? [] : shownMarks(hit)).at(-1)

  it("puts the grid's glyph and the base at the landing", () => {
    const hit = resolveSnap(frameOf({ x: 137, y: 42, z: 0 }))
    assert.strictEqual(hit?.relation, "grid")
    assert.deepStrictEqual(roles(hit, "source"), [{ kind: "dot", role: "source", at: { x: 140, y: 40, z: 0 } }])
    assert.deepStrictEqual(glyphOf(hit), { kind: "glyph", relation: "grid", at: { x: 140, y: 40, z: 0 } })
  })

  it("names a corner coincident, a middle of an edge a midpoint, and an edge's point on it", () => {
    const items = [cubeAt("a", { x: 200, y: 0, z: 0 })]
    const corner = resolveSnap(frameOf({ x: 146, y: 46, z: 0 }, { config: on(defaultSnapConfig, "mesh"), items }))
    assert.strictEqual(corner?.relation, "coincident")
    assert.deepStrictEqual(roles(corner, "target"), [{ kind: "dot", role: "target", at: { x: 150, y: 50, z: 50 } }])
    assert.deepStrictEqual(roles(corner, "source"), [{ kind: "dot", role: "source", at: { x: 150, y: 50, z: 50 } }])
    const meshed = [cubeAt("a", { x: 200, y: 0, z: 0 }, { mesh: () => meshOfBox(boxAt({ x: 200, y: 0, z: 0 })) })]
    const config = on(defaultSnapConfig, "mesh")
    assert.strictEqual(resolveSnap(frameOf({ x: 152, y: 2, z: 0 }, { config, items: meshed }))?.relation, "midpoint")
    const edge = resolveSnap(frameOf({ x: 152, y: 30, z: 0 }, { config, items: meshed }))
    assert.strictEqual(edge?.relation, "onEdge")
    assert.deepInclude(roles(edge, "target")[0], { kind: "line", role: "target" })
  })

  it("names a face on it, and perpendicular when Rotate to face stands the selection square on it", () => {
    const surfaceAt = () => ({ point: { x: 300, y: 300, z: 20 }, normal: X, item: "a", corners: [] })
    const config = on(defaultSnapConfig, "mesh")
    assert.strictEqual(resolveSnap(frameOf({ x: 300, y: 300, z: 0 }, { config, surfaceAt }))?.relation, "onFace")
    // the box of the item the face is on (its corners out of range here), and the selection's where it lands
    const items = [cubeAt("a", { x: 3000, y: 3000, z: 0 })]
    const onFace = resolveSnap(frameOf({ x: 300, y: 300, z: 0 }, { config, surfaceAt, items }))
    assert.deepStrictEqual(roles(onFace, "target").map(({ kind }) => kind), ["box", "face"])
    assert.deepStrictEqual(roles(onFace, "source").map(({ kind }) => kind), ["box", "dot"])
    const mesh = { ...config.targets.mesh, rotateToFace: "align" as const }
    const square = { ...config, targets: { ...config.targets, mesh } }
    assert.strictEqual(
      resolveSnap(frameOf({ x: 300, y: 300, z: 0 }, { config: square, surfaceAt }))?.relation,
      "perpendicular"
    )
  })

  /** A meshed cube whose faces across X are at 250 and 350. */
  const meshedAt = (x: number) => {
    const at = { x, y: 0, z: 0 }
    return [cubeAt("a", at, { mesh: () => meshOfBox(boxAt(at)) })]
  }

  it("draws both boxes of a flush stop with their faces tinted, the selection's on the target's plane", () => {
    const config = on(defaultSnapConfig, "mesh")
    const items = meshedAt(300)
    const bases = selectionBases(config, { pivot: ORIGIN, box: boxAt(ORIGIN), ends: [] }, line)
    const hit = resolveSnap(frameOf({ x: 197, y: 0, z: 0 }, { config, items, bases, constraint: line }))
    assert.strictEqual(hit?.relation, "flush")
    const [targetBox, target] = roles(hit, "target")
    const [sourceBox, source] = roles(hit, "source")
    assert.deepStrictEqual(targetBox, {
      kind: "box",
      role: "target",
      corners: cornersOf(boxAt({ x: 300, y: 0, z: 0 }))
    })
    assert.isTrue(target?.kind === "face" && target.corners.every(({ x }) => x === 250))
    // the selection's box where the stop puts it: its far face on the neighbour's near one
    assert.deepStrictEqual(sourceBox, {
      kind: "box",
      role: "source",
      corners: cornersOf(boxAt({ x: 200, y: 0, z: 0 }))
    })
    assert.isTrue(source?.kind === "face" && source.corners.every(({ x }) => x === 250))
    assert.deepInclude(glyphOf(hit), { relation: "flush" })
  })

  it("names the middle between two faces a midpoint, with its guide", () => {
    const config = on(defaultSnapConfig, "mesh")
    const items = meshedAt(300)
    const centre: BasePoint = { ...pivotBase, stop: { kind: "centre" } }
    const hit = resolveSnap(frameOf({ x: 297, y: 0, z: 0 }, { config, items, bases: [centre], constraint: line }))
    assert.strictEqual(hit?.relation, "midpoint")
    assert.deepStrictEqual(hit?.marks.map(({ kind }) => kind), ["guide", "dot"])
  })

  it("draws both ends of a join, and nothing more than its glyph", () => {
    const config = on(defaultSnapConfig, "connectors")
    const other = endAlongX("a", 0, 300, -1)
    const own = { ...pivotBase, start: { x: 50, y: 0, z: 0 }, end: endAlongX("own", 0, 50, 1) }
    const items = [cubeAt("a", { x: 350, y: 0, z: 0 }, { ends: [other] })]
    const hit = resolveSnap(frameOf({ x: 246, y: 0, z: 0 }, { config, items, bases: [own] }))
    assert.strictEqual(hit?.relation, "join")
    assert.deepStrictEqual(hit?.marks, [{ kind: "ring", role: "target", at: other.position }])
    assert.deepStrictEqual(roles(hit, "source"), [{ kind: "ring", role: "source", at: other.position }])
  })

  it("names a tracking line in line and where two cross an intersection", () => {
    const config = on(defaultSnapConfig, "tracking")
    const tracked = twoTracked
    assert.strictEqual(resolveSnap(frameOf({ x: 503, y: 300, z: 0 }, { config, tracked }))?.relation, "inLine")
    assert.strictEqual(resolveSnap(frameOf({ x: 504, y: 696, z: 0 }, { config, tracked }))?.relation, "intersection")
  })

  it("names a construction plane on a face, an axis on an edge, and a measurement's end coincident", () => {
    const config = on(defaultSnapConfig, "construction")
    const plane = resolveSnap(frameOf({ x: 5, y: 33, z: 0 }, { config, construction: [wall("Landing", 0)] }))
    assert.strictEqual(plane?.relation, "onFace")
    assert.deepInclude(plane?.marks[0], { kind: "face", role: "target" })
    const spine = { kind: "axis" as const, id: "a", name: "Spine", origin: ORIGIN, direction: X, extent: 1000 }
    assert.strictEqual(
      resolveSnap(frameOf({ x: 300, y: 3, z: 0 }, { config, construction: [spine] }))?.relation,
      "onEdge"
    )
    const measurements = [{ id: "m", a: { x: 100, y: 0, z: 0 }, b: { x: 400, y: 0, z: 0 } }]
    assert.strictEqual(
      resolveSnap(frameOf({ x: 396, y: 3, z: 0 }, { config, measurements }))?.relation,
      "coincident"
    )
  })
})
