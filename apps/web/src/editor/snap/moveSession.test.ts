import { assert, beforeEach, describe, it } from "@effect/vitest"
import type { Quat4, Vec3 } from "../../domain/coords"
import { identityTransform } from "../../domain/factory"
import { type GroupDelta, landedPoint } from "../../domain/groupTransform"
import { defaultKeybinds } from "../../domain/Keybinds"
import { defaultSnapConfig, type SnapConfig, type SnapKind } from "../../domain/snapConfig"
import type { Ray } from "../../domain/snapFrame"
import { findGroup } from "../../domain/structure"
import { ORIGIN, rotatorToQuat } from "../../domain/ueMath"
import { applyDelta } from "../../domain/units"
import { grouped, loadPieces, lookDown } from "../../test/snapFixtures"
import { assertVec } from "../../test/vec"
import { PaneCamera } from "../paneCameras"
import { selectionPivot, shownTransform, useEditor } from "../store"
import { type DragKeyEvent, handleDragKey, releaseDragKey, seedDragKeys, syncDragKeys } from "./dragKeys"
import { dragKeysOf, endSnapDisplay, MoveSession, type MoveStart, previewMove } from "./moveSession"
import { anchorUnder } from "./pickTarget"
import { selectionSnapStart } from "./selectionStart"
import { snapMarks } from "./snapMarks"
import { snapItemsOf } from "./snapScene"
import { snapViewOf } from "./snapView"

const yawTo = (yaw: number) => rotatorToQuat({ roll: 0, pitch: 0, yaw })

const topPane = () => lookDown(new PaneCamera())

const load = (config: SnapConfig | null) => {
  const ids = loadPieces([{ x: 0, y: 0, z: 0 }, { x: 300, y: 800, z: 0 }])
  if (config !== null) useEditor.getState().setTabSnap(config)
  return ids
}

/** A session moving the first item by `pivot`, and how to point at a world position. */
const moving = (key: string, pivot: Vec3 = { x: 0, y: 0, z: 0 }, frame?: Quat4, over: Partial<MoveStart> = {}) => {
  const pane = topPane()
  const view = snapViewOf(pane)
  const rayAt = (x: number, y: number): { readonly ray: Ray; readonly px: { x: number; y: number } } => {
    const px = view.project({ x, y, z: 0 }) ?? { x: 0, y: 0 }
    return { ray: view.rayAt(px), px }
  }
  const start = rayAt(pivot.x, pivot.y)
  const session = new MoveSession({
    pane,
    keys: new Set([key]),
    pivot,
    box: { min: { x: -250, y: -250, z: 0 }, max: { x: 250, y: 250, z: 100 } },
    ends: [],
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    frame,
    constraint: { kind: "surface", normal: { x: 0, y: 0, z: 1 } },
    ray: start.ray,
    px: start.px,
    ...over
  })
  return { rayAt, session, pointAt: (x: number, y: number) => session.update(rayAt(x, y).ray, rayAt(x, y).px, up) }
}

const onlyGrid = (over: Partial<SnapConfig> = {}): SnapConfig => ({
  ...defaultSnapConfig,
  enabled: true,
  targets: {
    ...defaultSnapConfig.targets,
    connectors: { ...defaultSnapConfig.targets.connectors, enabled: false },
    mesh: { ...defaultSnapConfig.targets.mesh, enabled: false },
    tracking: { ...defaultSnapConfig.targets.tracking, enabled: false },
    alignment: { ...defaultSnapConfig.targets.alignment, enabled: false }
  },
  ...over
})

const up = { invert: false, hold: false }

/** Only the corners of other items' bounds, with the grid on or off. */
const onlyCorners = (grid: boolean): SnapConfig => {
  const base = onlyGrid()
  const none = { ...base.targets.mesh.elements, boundsFaceCentres: false, boundsFaces: false, vertices: false }
  const elements = { ...none, sharpEdges: false, edgeMidpoints: false, faceCentres: false, faces: false }
  return {
    ...base,
    targets: {
      ...base.targets,
      grid: { ...base.targets.grid, enabled: grid },
      mesh: { ...base.targets.mesh, enabled: true, elements }
    }
  }
}

/** Only the faces of other items' bounds. */
const onlyBoundsFaces = (): SnapConfig => {
  const config = onlyCorners(false)
  const { mesh } = config.targets
  const elements = { ...mesh.elements, boundsCorners: false, boundsFaces: true }
  return { ...config, targets: { ...config.targets, mesh: { ...mesh, elements } } }
}

/** A session moving the first of two items, and the corner of the second it comes up to, along X. */
const towardsCorner = (config: SnapConfig, over: Partial<MoveStart> = {}) => {
  const [a = ""] = load(config)
  const [other] = snapItemsOf(useEditor.getState(), new Set([a]), 30)
  const corner = other?.box.min ?? { x: 0, y: 0, z: 0 }
  const drag = moving(a, ORIGIN, undefined, over)
  return { ...drag, corner, pointPast: (by: number, aside = 0) => drag.pointAt(corner.x + by, corner.y + aside) }
}

/** A selection with no size: the pivot is its faces and its centre, for a lock to stop on what the pivot comes up to. */
const noSize = { box: { min: ORIGIN, max: ORIGIN } }

const offsetOf = (delta: GroupDelta | undefined) => delta?.kind === "translate" ? delta.offset : undefined

describe("MoveSession", () => {
  beforeEach(() => endSnapDisplay())

  it("moves free with snapping off, and lands with Ctrl inverting it", () => {
    const [a = ""] = load({ ...onlyGrid(), enabled: false })
    const { rayAt, session } = moving(a)
    const { px, ray } = rayAt(137, 42)
    const free = session.update(ray, px, up)
    assert.isUndefined(free.hit)
    assert.strictEqual(free.delta?.kind, "translate")
    const inverted = session.update(ray, px, { invert: true, hold: false })
    assert.strictEqual(inverted.hit?.target, "grid")
    assert.deepStrictEqual(inverted.hit?.landing, { x: 140, y: 40, z: 0 })
  })

  it("goes free under Ctrl with snapping on", () => {
    const [a = ""] = load(onlyGrid())
    const { rayAt, session } = moving(a)
    const { px, ray } = rayAt(137, 42)
    assert.isDefined(session.update(ray, px, up).hit)
    assert.isUndefined(session.update(ray, px, { invert: true, hold: false }).hit)
  })

  it("keeps a held target under Ctrl, and lets go when Shift does", () => {
    const [a = ""] = load(onlyGrid())
    const { rayAt, session } = moving(a)
    const near = rayAt(137, 42)
    const held = session.update(near.ray, near.px, { invert: false, hold: true })
    const far = rayAt(600, 600)
    const still = session.update(far.ray, far.px, { invert: true, hold: true })
    assert.deepStrictEqual(still.hit?.landing, held.hit?.landing)
    assert.deepStrictEqual(session.update(far.ray, far.px, up).hit?.landing, { x: 600, y: 600, z: 0 })
  })

  it("locks to an axis, and a second press lets go", () => {
    const [a = ""] = load({ ...onlyGrid(), enabled: false })
    const { rayAt, session } = moving(a)
    const { px, ray } = rayAt(137, 42)
    session.toggleLock({ axis: "x", plane: false })
    const locked = session.update(ray, px, up).delta
    assert.isTrue(locked?.kind === "translate" && Math.abs(locked.offset.x - 137) < 1e-6 && locked.offset.y === 0)
    session.toggleLock({ axis: "x", plane: false })
    const free = session.update(ray, px, up).delta
    assert.isTrue(free?.kind === "translate" && Math.abs(free.offset.y - 42) < 1e-6)
  })

  it("keeps a local handle's axes on its move, free or landed, for each unit to take as its own", () => {
    const axes = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
    const [a = ""] = load(onlyGrid())
    const { rayAt, session } = moving(a, { x: 0, y: 0, z: 0 }, axes)
    const { px, ray } = rayAt(137, 42)
    const landed = session.update(ray, px, up)
    assert.deepStrictEqual(landed.delta, { kind: "translate", offset: { x: 140, y: 40, z: 0 }, frame: axes })
    const free = session.update(ray, px, { invert: true, hold: false })
    assert.isTrue(free.delta?.kind === "translate" && free.delta.frame === axes)
  })

  it("gives a world move no axes, and drops a local one's under a lock, which is on the grid's", () => {
    const axes = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
    const [a = ""] = load({ ...onlyGrid(), enabled: false })
    const world = moving(a).pointAt(137, 42).delta
    assert.isTrue(world?.kind === "translate" && world.frame === undefined)
    const { rayAt, session } = moving(a, { x: 0, y: 0, z: 0 }, axes)
    session.toggleLock({ axis: "x", plane: false })
    const { px, ray } = rayAt(137, 42)
    const locked = session.update(ray, px, up).delta
    assert.isTrue(locked?.kind === "translate" && locked.frame === undefined)
  })

  it("lands the pivot it's given, which for a whole group is the group's and not an item's", () => {
    const [a = ""] = load(onlyGrid())
    const { pointAt } = moving(a, { x: 3, y: 7, z: 0 })
    const { hit } = pointAt(103, 47)
    assert.deepStrictEqual(hit?.landing, { x: 100, y: 50, z: 0 })
    assert.deepStrictEqual(offsetOf(pointAt(103, 47).delta), { x: 97, y: 43, z: 0 })
  })

  it("says what happened for the history", () => {
    const [a = ""] = load(onlyGrid())
    const { pointAt, session } = moving(a)
    pointAt(137, 42)
    assert.deepStrictEqual(session.commitOptions(3), { connected: false, description: "Move 3 items to grid 10 cm" })
  })

  it("shows the label, and the base even with nothing near", () => {
    const [a = ""] = load({
      ...onlyGrid(),
      targets: { ...onlyGrid().targets, grid: { ...onlyGrid().targets.grid, enabled: false } }
    })
    moving(a).pointAt(137, 42)
    assert.strictEqual(useEditor.getState().snapFeedback, null)
    assert.isDefined(snapMarks.get().base)
  })

  it("clears what it showed when the move ends", () => {
    const [a = ""] = load(onlyGrid())
    moving(a).pointAt(137, 42)
    assert.strictEqual(useEditor.getState().snapFeedback?.label, "Grid 10 cm")
    endSnapDisplay()
    assert.strictEqual(useEditor.getState().snapFeedback, null)
    assert.isUndefined(snapMarks.get().base)
  })
})

describe("MoveSession snap-and-go", () => {
  beforeEach(() => {
    endSnapDisplay()
    useEditor.setState({ tracked: [] })
  })

  it("moves with the pointer up to a target, with nothing pulling it forward", () => {
    const { corner, pointPast } = towardsCorner(onlyCorners(false))
    for (const by of [-40, -11, -8, -4, -2]) {
      const { delta, hit } = pointPast(by)
      assert.isUndefined(hit, `${by} px short of the corner`)
      assert.closeTo(offsetOf(delta)?.x ?? 0, corner.x + by, 1e-6)
    }
  })

  it("stops on a target it reaches and stays there while the pointer goes on, then goes free past the range", () => {
    const { corner, pointPast } = towardsCorner(onlyCorners(false))
    pointPast(-20)
    pointPast(-3)
    const reached = pointPast(2)
    assert.strictEqual(reached.hit?.label, `Corner of ${reached.hit?.label.slice("Corner of ".length)}`)
    assert.closeTo(reached.hit?.landing.x ?? 0, corner.x, 1e-6)
    for (const by of [5, 9, 12]) assert.closeTo(pointPast(by).hit?.landing.x ?? 0, corner.x, 1e-6, `${by} px past it`)
    const gone = pointPast(14)
    assert.isUndefined(gone.hit)
    assert.closeTo(offsetOf(gone.delta)?.x ?? 0, corner.x + 14, 1e-6)
  })

  it("stays free going on past a target it left, and stops again coming back across it", () => {
    const { corner, pointPast } = towardsCorner(onlyCorners(false))
    pointPast(-3)
    pointPast(2)
    pointPast(14)
    assert.isUndefined(pointPast(10).hit)
    assert.isUndefined(pointPast(4).hit)
    assert.closeTo(pointPast(-1).hit?.landing.x ?? 0, corner.x, 1e-6)
  })

  it("stops on a target a fast sample crossed inside its range", () => {
    const { corner, pointPast } = towardsCorner(onlyCorners(false))
    pointPast(-30)
    assert.closeTo(pointPast(8).hit?.landing.x ?? 0, corner.x, 1e-6)
  })

  it("takes a point it passes close by, and leaves one it passes further off", () => {
    const close = towardsCorner(onlyCorners(false))
    close.pointPast(-20, 3)
    assert.isUndefined(close.pointPast(-2, 3).hit)
    assert.closeTo(close.pointPast(1, 3).hit?.landing.y ?? 0, close.corner.y, 1e-6)
    const wide = towardsCorner(onlyCorners(false))
    wide.pointPast(-20, 8)
    assert.isUndefined(wide.pointPast(1, 8).hit)
  })

  it("doesn't catch on a target it turned back from short of it", () => {
    const { pointPast } = towardsCorner(onlyCorners(false))
    pointPast(-20)
    pointPast(-3)
    assert.isUndefined(pointPast(-6).hit)
  })

  it("leaves a target the base started on", () => {
    const [a = ""] = load(onlyCorners(false))
    const [other] = snapItemsOf(useEditor.getState(), new Set([a]), 30)
    const corner = other?.box.min ?? { x: 0, y: 0, z: 0 }
    const { delta, hit } = moving(a, corner).pointAt(corner.x + 6, corner.y + 3)
    assert.isUndefined(hit)
    assert.closeTo(offsetOf(delta)?.x ?? 0, 6, 1e-6)
  })

  it("crosses a line at an angle and slides along it, until the pointer is past the range", () => {
    const [a = ""] = load({
      ...onlyCorners(false),
      targets: {
        ...onlyCorners(false).targets,
        mesh: { ...onlyCorners(false).targets.mesh, enabled: false },
        tracking: { ...onlyCorners(false).targets.tracking, enabled: true }
      }
    })
    useEditor.setState({ tracked: [{ at: { x: 200, y: 300, z: 0 }, label: "Corner of Kicker" }] })
    const { pointAt } = moving(a)
    assert.isUndefined(pointAt(170, 90).hit)
    assert.isUndefined(pointAt(192, 100).hit)
    const crossed = pointAt(205, 110).hit
    assert.closeTo(crossed?.landing.x ?? 0, 200, 1e-6)
    assert.closeTo(crossed?.landing.y ?? 0, 110, 1e-6)
    const slid = pointAt(209, 140).hit
    assert.closeTo(slid?.landing.x ?? 0, 200, 1e-6)
    assert.closeTo(slid?.landing.y ?? 0, 140, 1e-6)
    assert.isUndefined(pointAt(230, 150).hit)
  })

  it("leaves out an acquired point on what's moving, and keeps the rest", () => {
    const config = onlyGrid()
    const tracking = { ...config.targets.tracking, enabled: true }
    const [a = "", b = ""] = load({
      ...config,
      targets: { ...config.targets, grid: { ...config.targets.grid, enabled: false }, tracking }
    })
    const on = (item: string, x: number) => ({
      at: { x, y: 300, z: 0 },
      label: "End",
      on: { item, local: { x, y: 300, z: 0 } }
    })
    useEditor.setState({ tracked: [on(a, 200), on(b, 400)] })
    const { pointAt } = moving(a)
    pointAt(190, 100)
    assert.isUndefined(pointAt(205, 100).hit, "the line through the point that moves with it")
    pointAt(390, 100)
    assert.closeTo(pointAt(405, 100).hit?.landing.x ?? 0, 400, 1e-6)
  })

  it("acquires a neighbour's point and none of the selection's", () => {
    const [a = "", b = ""] = load(null)
    const pane = topPane()
    const view = snapViewOf(pane)
    const endOf = (key: string) =>
      snapItemsOf(useEditor.getState(), new Set(), 30).find((one) => one.key === key)?.ends[0]
    const under = (key: string) =>
      anchorUnder(useEditor.getState(), pane, view.project(endOf(key)?.position ?? ORIGIN) ?? { x: 0, y: 0 }, new Set())
    useEditor.getState().select([a])
    assert.isUndefined(under(a))
    assert.strictEqual(under(b)?.item, b)
    useEditor.getState().select([])
    assert.strictEqual(under(a)?.item, a)
  })

  it("lands on the grid on the way up to a target, and on the target once it's there", () => {
    const { corner, pointPast } = towardsCorner(onlyCorners(true))
    const near = pointPast(-7.3)
    assert.strictEqual(near.hit?.target, "grid")
    assert.closeTo((near.hit?.landing.x ?? 1) % 10, 0, 1e-6)
    const reached = pointPast(1)
    assert.strictEqual(reached.hit?.target, "mesh")
    assert.closeTo(reached.hit?.landing.x ?? 0, corner.x, 1e-6)
  })

  it("lands on nothing but the grid while its key is held, and on the target again once it's let go", () => {
    const { corner, pointPast, rayAt, session } = towardsCorner(onlyCorners(true))
    const pointWith = (by: number, only: ReadonlyArray<SnapKind>, invert = false) =>
      session.update(rayAt(corner.x + by, corner.y).ray, rayAt(corner.x + by, corner.y).px, { ...up, invert, only })
    pointWith(-20, ["grid"])
    assert.strictEqual(pointWith(1, ["grid"]).hit?.target, "grid")
    pointWith(-3, ["grid"])
    assert.strictEqual(pointPast(2).hit?.target, "mesh")
    pointWith(-20, ["mesh"])
    assert.isUndefined(pointWith(-7.3, ["mesh"]).hit, "the grid is off under the mesh's key")
    assert.isUndefined(pointWith(-7.3, ["grid"], true).hit, "Ctrl still inverts what the key narrowed to")
  })

  it("snaps to the kind held with snapping off, as Ctrl would, and Ctrl turns that off again", () => {
    const { corner, rayAt, session } = towardsCorner({ ...onlyCorners(true), enabled: false })
    const at = rayAt(corner.x - 7.3, corner.y)
    assert.isUndefined(session.update(at.ray, at.px, up).hit)
    assert.strictEqual(session.update(at.ray, at.px, { ...up, only: ["grid"] }).hit?.target, "grid")
    assert.isUndefined(session.update(at.ray, at.px, { invert: true, hold: false, only: ["grid"] }).hit)
  })

  it("ignores the step's key, which means nothing to a move", () => {
    const { corner, rayAt, session } = towardsCorner(onlyCorners(true))
    const at = rayAt(corner.x - 7.3, corner.y)
    assert.strictEqual(session.update(at.ray, at.px, { ...up, only: ["step"] }).hit?.target, "grid")
  })

  it("keeps a target Shift holds past its range, and lets go past the range when Shift does", () => {
    const { corner, rayAt, session, pointPast } = towardsCorner(onlyCorners(false))
    pointPast(-3)
    pointPast(2)
    const far = rayAt(corner.x + 60, corner.y)
    const held = session.update(far.ray, far.px, { invert: false, hold: true })
    assert.closeTo(held.hit?.landing.x ?? 0, corner.x, 1e-6)
    const under = session.update(far.ray, far.px, { invert: true, hold: true })
    assert.closeTo(under.hit?.landing.x ?? 0, corner.x, 1e-6)
    assert.isUndefined(session.update(far.ray, far.px, up).hit)
  })

  it("holds nothing with Shift while it's only near a target", () => {
    const { rayAt, corner, session, pointPast } = towardsCorner(onlyCorners(false))
    pointPast(-20)
    const near = rayAt(corner.x - 6, corner.y)
    assert.isUndefined(session.update(near.ray, near.px, { invert: false, hold: true }).hit)
  })

  it("goes free under Ctrl on a target, and stays free when Ctrl lets go inside its range", () => {
    const { corner, rayAt, session, pointPast } = towardsCorner(onlyCorners(false))
    pointPast(-3)
    pointPast(2)
    const inside = rayAt(corner.x + 6, corner.y)
    assert.isUndefined(session.update(inside.ray, inside.px, { invert: true, hold: false }).hit)
    assert.isUndefined(session.update(inside.ray, inside.px, up).hit)
  })

  it("starts over when a lock changes what the move can reach", () => {
    const config = onlyBoundsFaces()
    const { mesh } = config.targets
    const elements = { ...mesh.elements, boundsCorners: true }
    const withCorners = { ...config, targets: { ...config.targets, mesh: { ...mesh, elements } } }
    const { session, pointPast } = towardsCorner(withCorners, noSize)
    pointPast(-3)
    assert.isDefined(pointPast(2).hit)
    session.toggleLock({ axis: "x", plane: false })
    assert.isUndefined(pointPast(3).hit)
  })

  it("stops an axis lock at a neighbour's faces and not at its corners", () => {
    const { session, pointPast } = towardsCorner(onlyCorners(false))
    session.toggleLock({ axis: "x", plane: false })
    pointPast(-3)
    assert.isUndefined(pointPast(2).hit, "only its corners are on")
    const faces = towardsCorner(onlyBoundsFaces(), noSize)
    faces.session.toggleLock({ axis: "x", plane: false })
    faces.pointPast(-3)
    assert.match(faces.pointPast(2).hit?.label ?? "", /^Face of /)
  })

  it("names the target it ended on for the history, and nothing it only came near", () => {
    const { pointPast, session } = towardsCorner(onlyCorners(false))
    pointPast(-20)
    pointPast(-3)
    assert.deepStrictEqual(session.commitOptions(1), {})
    pointPast(2)
    assert.include(session.commitOptions(1).description ?? "", "Move 1 item to corner of ")
  })
})

describe("a landing that turns a group with a Point pivot", () => {
  const WORLD = { x: 950, y: 0, z: 0 }

  /** `a` with its +X end facing +Y, `b` and `c` grouped on a Point, and a live drag bringing `b`'s end up to `a`'s. */
  const landingDrag = () => {
    const [a = "", b = "", c = ""] = loadPieces([{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }, {
      x: 1500,
      y: 0,
      z: 0
    }])
    const { connectors } = defaultSnapConfig.targets
    const grid = { ...defaultSnapConfig.targets.grid, enabled: false }
    useEditor.getState().setTabSnap(onlyGrid({
      targets: { ...onlyGrid().targets, connectors: { ...connectors, enabled: true }, grid }
    }))
    useEditor.getState().transformItems(new Map([[a, { ...identityTransform(), rotation: yawTo(90) }]]))
    const id = grouped([b, c])
    useEditor.getState().setGroupPivot(id, { choice: "point", world: WORLD })
    useEditor.getState().select([b, c])
    const s = useEditor.getState()
    const startTransforms = new Map([b, c].flatMap((key) => {
      const t = shownTransform(s, key)
      return t === undefined ? [] : [[key, t] as const]
    }))
    const target = selectionPivot(s, (key) => startTransforms.get(key))
    if (target === undefined) return assert.fail("nothing to drag")
    const { ends } = selectionSnapStart(s, startTransforms, [b, c])
    const drag = moving(b, target.pivot, undefined, { keys: new Set([b, c]), ends })
    // the pointer as far from the pivot as `b`'s -X end is from `a`'s +X end
    const { delta } = drag.pointAt(WORLD.x - 750, 250)
    if (delta?.kind !== "rigid") return assert.fail(`the end didn't land: ${delta?.kind}`)
    const next = applyDelta(target.selection, "together", startTransforms, delta)
    return { delta, next, session: drag.session, id }
  }
  const shownPivot = () => {
    const s = useEditor.getState()
    return selectionPivot(s, (key) => shownTransform(s, key))?.pivot ?? ORIGIN
  }

  it("carries the gizmo with the landing as it shows, and the commit leaves it there", () => {
    const { delta, next, session } = landingDrag()
    const landed = landedPoint(WORLD, delta)
    assert.isAbove(Math.abs(landed.y - WORLD.y), 1, "the landing moves the Point")
    previewMove(next, delta)
    assertVec(shownPivot(), landed, "live")
    const options = session.commitOptions(next.size)
    useEditor.getState().setPreview(null)
    useEditor.getState().transformItems(next, options)
    assertVec(shownPivot(), landed, "committed")
  })

  it("puts the gizmo back when the drag is cancelled", () => {
    const { delta, id, next } = landingDrag()
    previewMove(next, delta)
    useEditor.getState().setPreview(null)
    assertVec(shownPivot(), WORLD, "the Point it had")
    assert.deepStrictEqual(findGroup(useEditor.getState().doc.structure.tree, id)?.pivot, {
      choice: "point",
      world: WORLD
    })
  })
})

describe("drag keys", () => {
  const key = (code: string, modifiers: Partial<DragKeyEvent> = {}): DragKeyEvent => ({
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault: () => {},
    stopImmediatePropagation: () => {},
    ...modifiers
  })

  it("counts a modifier pressed before the drag, and forgets one released away from it", () => {
    const state = seedDragKeys({ ctrlKey: true, shiftKey: false })
    assert.isTrue(dragKeysOf(defaultKeybinds, state.pressed).invert)
    syncDragKeys(state, { ctrlKey: false, shiftKey: true })
    assert.deepStrictEqual(dragKeysOf(defaultKeybinds, state.pressed), { invert: false, hold: true, only: [] })
  })

  it("narrows while a kind's key is held, Ctrl still inverting, and lets go when the key comes up", () => {
    const state = seedDragKeys({ ctrlKey: false, shiftKey: false })
    let stopped = false
    const stop = () => {
      stopped = true
    }
    assert.isTrue(handleDragKey(state, undefined, key("KeyG", { stopImmediatePropagation: stop }), defaultKeybinds))
    assert.isTrue(stopped, "nothing else hears the key mid-drag")
    assert.deepStrictEqual(dragKeysOf(defaultKeybinds, state.pressed).only, ["grid"])
    handleDragKey(state, undefined, key("KeyM"), defaultKeybinds)
    syncDragKeys(state, { ctrlKey: true, shiftKey: false })
    assert.deepStrictEqual(dragKeysOf(defaultKeybinds, state.pressed), {
      invert: true,
      hold: false,
      only: ["grid", "mesh"]
    })
    releaseDragKey(state, "KeyG")
    releaseDragKey(state, "KeyM")
    assert.deepStrictEqual(dragKeysOf(defaultKeybinds, state.pressed).only, [])
  })

  it("holds a rebound key with its modifiers, by either hand", () => {
    const keybinds = { ...defaultKeybinds, snapOnlyMesh: ["Shift+KeyM"] }
    const state = seedDragKeys({ ctrlKey: false, shiftKey: false })
    handleDragKey(state, undefined, key("KeyM"), keybinds)
    assert.deepStrictEqual(dragKeysOf(keybinds, state.pressed).only, [])
    syncDragKeys(state, { ctrlKey: false, shiftKey: true })
    assert.deepStrictEqual(dragKeysOf(keybinds, state.pressed).only, ["mesh"])
  })

  it("takes a lock key, Shift making it the plane, and Ctrl leaving it alone", () => {
    const [a = ""] = load(onlyGrid())
    const { session } = moving(a)
    const state = seedDragKeys({ ctrlKey: false, shiftKey: false })
    assert.isTrue(handleDragKey(state, session, key("KeyX"), defaultKeybinds))
    assert.deepStrictEqual(session.lock, { axis: "x", plane: false })
    assert.isTrue(handleDragKey(state, session, key("KeyZ", { shiftKey: true }), defaultKeybinds))
    assert.deepStrictEqual(session.lock, { axis: "z", plane: true })
    assert.isTrue(handleDragKey(state, session, key("KeyY", { ctrlKey: true }), defaultKeybinds))
    assert.deepStrictEqual(session.lock, { axis: "y", plane: false })
  })

  it("leaves a key that isn't the drag's, and a turn takes no lock", () => {
    const state = seedDragKeys({ ctrlKey: false, shiftKey: false })
    assert.isFalse(handleDragKey(state, undefined, key("KeyX"), defaultKeybinds))
    const [a = ""] = load(onlyGrid())
    assert.isFalse(handleDragKey(state, moving(a).session, key("KeyK"), defaultKeybinds))
  })
})
