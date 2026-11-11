import { assert, describe, it } from "@effect/vitest"
import { defaultSnapConfig } from "../../domain/snapConfig"
import { ORIGIN } from "../../domain/ueMath"
import { catalogWithEnds, loadPieces, lookDown } from "../../test/snapFixtures"
import { PaneCamera } from "../paneCameras"
import { useEditor } from "../store"
import { snappedDrop } from "./pieceDrop"
import { snapViewOf } from "./snapView"

/** The Mesh target's bounds corners alone. */
const onlyCorners = () => {
  const { targets } = defaultSnapConfig
  const elements = Object.fromEntries(
    Object.keys(targets.mesh.elements).map((name) => [name, name === "boundsCorners"])
  )
  useEditor.getState().setTabSnap({
    ...defaultSnapConfig,
    magnet: true,
    targets: {
      ...targets,
      grid: { ...targets.grid, enabled: false },
      connectors: { ...targets.connectors, enabled: false },
      mesh: { ...targets.mesh, elements: { ...targets.mesh.elements, ...elements } },
      tracking: { enabled: false },
      alignment: { ...targets.alignment, enabled: false }
    }
  })
}

describe("snappedDrop", () => {
  it("takes no target from a piece an isolation leaves out, though the document is the same", () => {
    const [near = "", far = ""] = loadPieces([ORIGIN, { x: 3000, y: 0, z: 0 }])
    onlyCorners()
    const piece = catalogWithEnds().pieces[1] ?? assert.fail("the bundled catalog has one piece")
    const pane = lookDown(new PaneCamera())
    const corner = { x: 500, y: 500, z: 0 }
    const px = snapViewOf(pane).project(corner) ?? assert.fail("the corner is in view")
    const drop = () => snappedDrop(useEditor.getState(), piece, pane, px, corner, false)
    assert.strictEqual(drop()?.hit.item, near)
    useEditor.getState().select([far])
    useEditor.getState().toggleIsolation()
    assert.notStrictEqual(drop()?.hit.item, near)
  })
})
