import { assert, describe, it } from "@effect/vitest"
import { boxAt, cubeAt, meshOfBox, topView } from "../test/snapFixtures"
import type { Vec3 } from "./coords"
import { defaultSnapConfig, type SnapConfig, type SnapTarget, withPreset, withTargetMoved } from "./snapConfig"
import type { BasePoint, SnapFrame, SnapHit, TrackedPoint } from "./snapFrame"
import { moveOf, resolveDrag, resolveSnap } from "./snapResolve"
import { meshHits } from "./snapTargets"
import { selectionBases } from "./snapTools"
import { IDENTITY_QUAT, ORIGIN } from "./ueMath"

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

const frameOf = (offset: Vec3, extra: Partial<SnapFrame> = {}): SnapFrame => ({
  config: on(defaultSnapConfig, "grid", "mesh"),
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
    const through = {
      ...base,
      targets: { ...base.targets, mesh: { ...base.targets.mesh, occlusion: "through" as const } }
    }
    assert.strictEqual(resolveSnap(frameOf({ x: 150, y: 50, z: 0 }, { config: through, items, occluded }))?.rank, 0)
  })

  it("skips a bounds face something hides, and takes it when the setting looks through pieces", () => {
    const base = on(defaultSnapConfig, "mesh")
    const elements = Object.fromEntries(Object.keys(base.targets.mesh.elements).map((name) => [name, false]))
    const faces = { ...base.targets.mesh.elements, ...elements, boundsFaces: true }
    const front = { ...base, targets: { ...base.targets, mesh: { ...base.targets.mesh, elements: faces } } }
    const through = {
      ...front,
      targets: { ...front.targets, mesh: { ...front.targets.mesh, occlusion: "through" as const } }
    }
    const items = [cubeAt("a", { x: 200, y: 0, z: 0 })]
    const occluded = () => true
    const at = { x: 200, y: 0, z: 0 }
    assert.isUndefined(resolveSnap(frameOf(at, { config: front, items, occluded })))
    assert.strictEqual(resolveSnap(frameOf(at, { config: through, items, occluded }))?.item, "a")
    assert.strictEqual(resolveSnap(frameOf(at, { config: front, items, occluded: () => false }))?.item, "a")
  })

  it("only takes the value along a locked axis, with the target under the pointer", () => {
    const config = on(defaultSnapConfig, "mesh")
    const items = [cubeAt("a", { x: 200, y: 300, z: 0 })]
    const hit = resolveSnap(
      frameOf({ x: 150, y: 0, z: 0 }, {
        config,
        items,
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
    const reachedFrom = (from: number) => resolveSnap(frameOf(inside, { config, items: slab(from), constraint: line }))
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
      marks: [],
      held: { shape: "segment" as const, from: edge[0], to: edge[1] }
    }
    const hit = resolveSnap(frameOf({ x: 600, y: 300, z: 0 }), held)
    assert.deepStrictEqual(hit?.landing, { x: 600, y: 0, z: 0 })
    assert.strictEqual(hit?.label, "Edge of Cube")
  })

  it("snaps to a tracking line through an acquired point, and to where two cross", () => {
    const config = on(defaultSnapConfig, "tracking")
    const tracked: ReadonlyArray<TrackedPoint> = [
      { at: { x: 500, y: 0, z: 0 }, label: "Corner of Kicker" },
      { at: { x: 0, y: 700, z: 0 }, label: "Corner of Curve" }
    ]
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
  /** What the item offers a base in its middle, in a pane where the whole cube is in range. */
  const offered = (item: typeof meshed, constraint: SnapFrame["constraint"]) =>
    meshHits(frameOf(at, { config, view: topView(10), items: [item], constraint }))
  const labels = (hits: ReadonlyArray<{ readonly label: string }>) =>
    [...new Set(hits.map(({ label }) => label))].sort()
  const planes = (hits: ReadonlyArray<SnapHit>) => hits.flatMap(({ held }) => held.shape === "plane" ? [held] : [])

  it("offers the faces along a line, the plane between them and the face centres, and no vertex", () => {
    const hits = offered(meshed, line)
    assert.deepStrictEqual(labels(hits), ["Centre of a face of Cube", "Face of Cube", "Middle of Cube"])
    const stops = hits.filter(({ rank }) => rank === 2).map(({ landing }) => landing.x).toSorted((a, b) => a - b)
    assert.deepStrictEqual(stops, [250, 300, 350])
    assert.deepStrictEqual(planes(hits)[0], {
      shape: "plane",
      origin: { x: 250, y: 0, z: 0 },
      normal: { x: -1, y: 0, z: 0 }
    })
    assert.lengthOf(hits.filter(({ rank }) => rank === 0), 6)
  })

  it("offers vertices, edges and midpoints to a surface drag, and no stations", () => {
    const names = labels(offered(meshed, { kind: "surface", normal: { x: 0, y: 0, z: 1 } }))
    assert.includeMembers(names, ["Vertex of Cube", "Edge of Cube", "Middle of an edge of Cube"])
    assert.notInclude(names, "Middle of Cube")
  })

  it("offers the faces along both of a plane's axes, and leaves the other value alone", () => {
    const hits = planes(offered(meshed, plane))
    const normals = hits.map(({ normal }) => [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].join())
    assert.deepStrictEqual([...new Set(normals)].sort(), ["0,1,0", "1,0,0"])
    const free = { x: 345, y: 20, z: 0 }
    const landing = resolveSnap(frameOf(free, { config, items: [meshed], constraint: plane }))?.landing
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
        frameOf(at, { config, items: [{ ...meshed, mesh: () => tilted(n) }], view: topView(10), constraint: line })
      )
        .find(({ label }) => label === "Face of Cube")
    assert.closeTo(hit(normal)?.landing.x ?? 0, 340 + 100 * Math.tan(turn), 1e-6)
    assert.isUndefined(hit({ x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }))
  })

  it("keeps a face's Offset, and leaves it off the middle", () => {
    const mesh = { ...config.targets.mesh, offset: 7 }
    const offset = { ...config, targets: { ...config.targets, mesh } }
    const hits = meshHits(frameOf(at, { config: offset, view: topView(10), items: [meshed], constraint: line }))
    const stops = hits.filter(({ rank }) => rank === 2).map(({ landing }) => landing.x).toSorted((a, b) => a - b)
    assert.deepStrictEqual(stops, [243, 300, 357])
  })

  it("stops at a station something hides, as the move doesn't look at it", () => {
    const hit = resolveSnap(
      frameOf({ x: 345, y: 0, z: 0 }, { config, items: [meshed], constraint: line, occluded: () => true })
    )
    assert.deepStrictEqual(hit?.landing, { x: 350, y: 0, z: 0 })
  })

  it("lets bounds stand in only for an item with no mesh", () => {
    const surface = { kind: "surface", normal: { x: 0, y: 0, z: 1 } } as const
    assert.includeMembers(labels(offered(unloaded, surface)), ["Corner of Cube", "Face of Cube"])
    assert.notInclude(labels(offered(meshed, surface)), "Corner of Cube")
    assert.notInclude(labels(offered(meshed, surface)), "Face of Cube")
    assert.deepStrictEqual(labels(offered(unloaded, line)), [
      "Centre of a face of Cube",
      "Face of Cube",
      "Middle of Cube"
    ])
  })

  it("leaves the faces and the centres to their own toggles, by what stands in", () => {
    const { elements } = config.targets.mesh
    const without = (off: Partial<typeof elements>) => ({
      ...config,
      targets: { ...config.targets, mesh: { ...config.targets.mesh, elements: { ...elements, ...off } } }
    })
    const hitsOf = (item: typeof meshed, off: Partial<typeof elements>) =>
      labels(meshHits(frameOf(at, { config: without(off), view: topView(10), items: [item], constraint: line })))
    assert.deepStrictEqual(hitsOf(meshed, { faces: false }), ["Centre of a face of Cube"])
    assert.deepStrictEqual(hitsOf(meshed, { faceCentres: false }), ["Face of Cube", "Middle of Cube"])
    assert.deepStrictEqual(hitsOf(unloaded, { boundsFaces: false }), ["Centre of a face of Cube"])
    assert.deepStrictEqual(hitsOf(unloaded, { boundsFaceCentres: false }), ["Face of Cube", "Middle of Cube"])
  })

  it("lands start on start, centre on centre and end on end, moving a 500 cm piece into a 1000 cm one", () => {
    const box = { min: { x: -250, y: -50, z: -50 }, max: { x: 250, y: 50, z: 50 } }
    const long = { min: { x: 1500, y: -50, z: -50 }, max: { x: 2500, y: 50, z: 50 } }
    const { mesh } = config.targets
    const centred = {
      ...config,
      base: "centre" as const,
      targets: { ...config.targets, mesh: { ...mesh, elements: { ...mesh.elements, faceCentres: false } } }
    }
    const bases = selectionBases(centred, { pivot: { x: 0, y: 0, z: -50 }, box, ends: [] }, line)
    const items = [cubeAt("a", ORIGIN, { box: long, mesh: () => meshOfBox(long) })]
    let from: Vec3 = ORIGIN
    let current: ReturnType<typeof resolveDrag>
    const stops = new Map<number, string>()
    for (let x = 1200; x < 2800; x += 4) {
      const offset = { x, y: 0, z: 0 }
      current = resolveDrag(frameOf(offset, { config: centred, box, bases, items, constraint: line }), {
        from,
        current
      })
      from = offset
      if (current !== undefined) stops.set(moveOf(current).offset.x, current.base.label)
    }
    assert.deepStrictEqual([...stops], [
      [1250, "Far face"],
      [1500, "Centre"],
      [1750, "Near face"],
      [2000, "Centre"],
      [2250, "Far face"],
      [2500, "Centre"],
      [2750, "Near face"]
    ])
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
  const dragAlong = (xs: ReadonlyArray<number>, extra: Partial<SnapFrame>) => {
    let from: Vec3 = ORIGIN
    let current: ReturnType<typeof resolveDrag>
    return xs.map((x) => {
      const offset = { x, y: 0, z: 0 }
      current = resolveDrag(frameOf(offset, extra), { from, current })
      from = offset
      return current
    })
  }

  it("takes a face under the base at once, as it has nothing to jump across", () => {
    const surfaceAt = () => ({ point: { x: 300, y: 300, z: 20 }, normal: { x: 0, y: 0, z: 1 }, item: "a", corners: [] })
    const config = only("mesh")
    const hit = resolveDrag(frameOf({ x: 300, y: 300, z: 0 }, { config, surfaceAt }), {
      from: ORIGIN,
      current: undefined
    })
    assert.deepStrictEqual(hit?.landing, { x: 300, y: 300, z: 20 })
  })

  it("stops a locked move at a face in reach only once the move gets there", () => {
    const box = { min: { x: 155, y: -50, z: -50 }, max: { x: 1000, y: 50, z: 50 } }
    const items = [cubeAt("a", ORIGIN, { box, mesh: () => meshOfBox(box) })]
    const hits = dragAlong([100, 150, 154, 156, 164, 168], { config: only("mesh"), items, constraint: line })
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
