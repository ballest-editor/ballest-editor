import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "../../domain/bundledCatalog.json"
import { Catalog, indexCatalog, pieceIdOf } from "../../domain/Catalog"
import type { Vec3 } from "../../domain/coords"
import { placementTransform } from "../../domain/factory"
import { itemsBoxOf } from "../../domain/itemBounds"
import { pieceFootprint, PLACEMENT_COLUMNS, PLACEMENT_GAP } from "../../domain/placement"
import { defaultSettings } from "../../domain/Settings"
import { VIEW_DOWN } from "../../test/placementView"
import { initialMap, useEditor } from "../store"
import { placeAt, placeAtCamera, spreadPlacement, toggleFavouritePiece } from "./placement"

const catalog = Schema.decodeUnknownSync(Catalog)(fixture)
const pieceOf = (className: string) => catalog.pieces.find((p) => p.className === className)!
const cube = pieceOf("BP_Prim_Cube")
const track = pieceOf("BP_Track_Short1")
const width = pieceFootprint(cube)
const STEP = width + PLACEMENT_GAP

const POINT = { x: 2000, y: 0, z: 0 }

const s = () => useEditor.getState()

/** A click in the Pieces panel: where the piece went. */
const click = (point: Vec3 = POINT, view = VIEW_DOWN) => {
  const at = spreadPlacement(point, width, view)
  s().placePiece(cube, placementTransform(cube, at))
  return at
}
const clicks = (count: number) => Array.from({ length: count }, () => click())
const lastId = () => s().doc.ids.at(-1)!

describe("spreadPlacement", () => {
  beforeEach(() => {
    useEditor.setState({ catalogIndex: indexCatalog(catalog), settings: defaultSettings })
    s().loadMap(initialMap(), null)
  })

  it("leaves the first placement where the view puts it", () => {
    assert.deepStrictEqual(click(), POINT)
  })

  it("steps each placement from the last while the camera stays put", () => {
    assert.deepStrictEqual(clicks(3), [POINT, { ...POINT, y: STEP }, { ...POINT, y: 2 * STEP }])
  })

  it("puts the piece in the map at that spot, selected", () => {
    clicks(2)
    const item = s().doc.map.items.at(-1)!
    assert.deepStrictEqual(item.itemTransform.translation, { ...POINT, y: STEP })
    assert.deepStrictEqual(s().selectedIds, [lastId()])
  })

  it("wraps to a new row after a few", () => {
    const points = clicks(PLACEMENT_COLUMNS + 2)
    assert.deepStrictEqual(points[PLACEMENT_COLUMNS], { ...POINT, x: POINT.x + STEP })
    assert.deepStrictEqual(points[PLACEMENT_COLUMNS + 1], { ...POINT, x: POINT.x + STEP, y: STEP })
  })

  it("snaps a step up to the grid size in the settings", () => {
    useEditor.setState({ settings: { ...defaultSettings, snapping: { ...defaultSettings.snapping, gridSize: 250 } } })
    assert.deepStrictEqual(clicks(2)[1], { ...POINT, y: 1250 })
  })

  it("starts a new run along the view when the camera moves, or only turns", () => {
    click()
    const moved = { ...VIEW_DOWN, position: { ...VIEW_DOWN.position, x: 10 } }
    assert.deepStrictEqual(click(POINT, moved), { ...POINT, y: STEP })
    const turned = { ...moved, right: { x: 1, y: 0, z: 0 } }
    assert.deepStrictEqual(click(POINT, turned), { ...POINT, x: POINT.x + STEP })
  })

  it("steps once off an item standing where the view puts the first piece", () => {
    s().placePiece(cube, placementTransform(cube, POINT))
    s().select([])
    assert.deepStrictEqual(click(), { ...POINT, y: STEP })
  })

  it("leaves the spot alone for an item wholly below it", () => {
    s().placePiece(cube, placementTransform(cube, { ...POINT, z: -5000 }))
    s().select([])
    assert.deepStrictEqual(click(), POINT)
  })

  it("passes over an earlier run's pieces, however that run ended", () => {
    const earlier = clicks(PLACEMENT_COLUMNS)
    s().select([])
    assert.deepStrictEqual(click(), { ...POINT, x: POINT.x + STEP })
    const first = lastId()
    assert.deepStrictEqual(click(), { ...POINT, x: POINT.x + STEP, y: STEP })
    s().select([s().doc.ids[0]!])
    assert.deepStrictEqual(click(), { ...POINT, x: POINT.x + STEP, y: 2 * STEP })
    s().select([first, lastId()])
    assert.deepStrictEqual(click(), { ...POINT, x: POINT.x + 2 * STEP })
    assert.deepStrictEqual(earlier, [POINT, { ...POINT, y: STEP }, { ...POINT, y: 2 * STEP }])
  })

  it("keeps a run going past a crowded spot, each piece on a spot of its own", () => {
    clicks(PLACEMENT_COLUMNS)
    s().select([])
    const spots = clicks(10 * PLACEMENT_COLUMNS).map(({ x, y }) => `${x} ${y}`)
    assert.strictEqual(new Set(spots).size, spots.length)
    assert.notInclude(spots, `${POINT.x} ${POINT.y}`)
  })

  it("keeps a run in view, going round the aim point once it reaches the edge", () => {
    const narrow = {
      ...VIEW_DOWN,
      project: ({ x, y }: Vec3) => ({ x: y / (2 * STEP), y: (x - POINT.x) / (2 * STEP), z: 0 })
    }
    const spots = Array.from({ length: 4 }, () => click(POINT, narrow))
    assert.deepStrictEqual(spots.slice(0, 2), [POINT, { ...POINT, y: STEP }])
    assert.isTrue(spots.every(({ x, y }) => Math.abs(y) <= STEP && Math.abs(x - POINT.x) <= STEP))
    assert.strictEqual(new Set(spots.map(({ x, y }) => `${x} ${y}`)).size, spots.length)
  })

  it("takes a spot again once the piece on it has gone", () => {
    click()
    s().undo()
    assert.deepStrictEqual(click(), POINT)
    s().deleteSelection()
    assert.deepStrictEqual(click(), POINT)
  })

  it("starts over after the last piece is undone or deleted", () => {
    click()
    click()
    s().undo()
    assert.deepStrictEqual(click(), { ...POINT, y: STEP })
    s().deleteSelection()
    assert.deepStrictEqual(click(), { ...POINT, y: STEP })
  })

  it("leaves a placement that wouldn't land on the run alone", () => {
    click()
    const clear = { ...POINT, x: POINT.x + 2 * width }
    assert.deepStrictEqual(click(clear), clear)
  })

  it("starts over when the first piece was dragged off the spot", () => {
    click()
    const item = s().doc.map.items.at(-1)!
    s().transformItems(
      new Map([[lastId(), { ...item.itemTransform, translation: { ...POINT, x: POINT.x + 3 * width } }]])
    )
    assert.deepStrictEqual(click(), POINT)
  })

  it("measures the piece before as it stands in the map", () => {
    click()
    const item = s().doc.map.items.at(-1)!
    s().transformItems(new Map([[lastId(), { ...item.itemTransform, scale3D: { x: 2, y: 3, z: 1 } }]]))
    assert.strictEqual(click().y, 3 * width + PLACEMENT_GAP)
  })
})

describe("placeAt", () => {
  const box = () => itemsBoxOf(s().doc.map.items.slice(-1), s().catalogIndex)!

  beforeEach(() => {
    useEditor.setState({ catalogIndex: indexCatalog(catalog), settings: defaultSettings })
    s().loadMap(initialMap(), null)
  })

  it("stands the piece on the hit point, centred over it, whatever its pivot", () => {
    const offCentre = {
      ...track,
      mainRelativeTransform: { ...track.mainRelativeTransform!, location: [100, 0, -50] as const }
    }
    for (const piece of [cube, offCentre]) {
      placeAt(piece, { x: 1200, y: -300, z: 40 })
      const { max, min } = box()
      assert.closeTo((min.x + max.x) / 2, 1200, 1)
      assert.closeTo((min.y + max.y) / 2, -300, 1)
      assert.closeTo(min.z, 40, 1)
    }
  })

  it("selects what it placed, as one undo step", () => {
    const before = s().doc.ids.length
    placeAt(cube, POINT)
    assert.deepStrictEqual(s().selectedIds, [lastId()])
    s().undo()
    assert.strictEqual(s().doc.ids.length, before)
  })

  it("lets the next click start a run of its own", () => {
    click()
    placeAt(cube, { x: 9000, y: 9000, z: 0 })
    assert.deepStrictEqual(click(), { ...POINT, y: STEP })
  })
})

describe("Recent and Favourites", () => {
  const recent = () => s().settings.panels.recentPieces

  beforeEach(() => {
    useEditor.setState({ catalogIndex: indexCatalog(catalog), settings: defaultSettings })
    s().loadMap(initialMap(), null)
  })

  it("lists what a click or a drop placed, newest first", () => {
    placeAtCamera(cube)
    placeAt(track, POINT)
    assert.deepStrictEqual(recent(), [pieceIdOf(track), pieceIdOf(cube)])
  })

  it("leaves out a piece that didn't go in", () => {
    const placePiece = s().placePiece
    useEditor.setState({ placePiece: () => undefined })
    placeAtCamera(cube)
    useEditor.setState({ placePiece })
    assert.deepStrictEqual(recent(), [])
  })

  it("stars a piece, and takes the star off", () => {
    void toggleFavouritePiece(cube)
    assert.deepStrictEqual(s().settings.panels.favouritePieces, [pieceIdOf(cube)])
    void toggleFavouritePiece(cube)
    assert.deepStrictEqual(s().settings.panels.favouritePieces, [])
  })
})
