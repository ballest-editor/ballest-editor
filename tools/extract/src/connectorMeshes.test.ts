// connectors.json against the meshes (docs/qa/connectors.md § Checks without the game): the survey still reads the same
// ends off them, each end is the front of its piece, and two ends of one profile, joined the way the editor joins them,
// have caps that lie on each other. Needs the meshes: `pnpm assets` downloads the asset pack.
import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Catalog, indexCatalog } from "../../../apps/web/src/domain/Catalog.ts"
import { endsMeet, endsOf, meetingTurn, type WorldEnd } from "../../../apps/web/src/domain/connectors.ts"
import { identityTransform, itemFromPiece } from "../../../apps/web/src/domain/factory.ts"
import { ItemTransform } from "../../../apps/web/src/domain/MapFile.ts"
import { localToWorld } from "../../../apps/web/src/domain/pivot.ts"
import { rotateVec } from "../../../apps/web/src/domain/ueMath.ts"
import { add, capsOf, cross, dot, measureCap, type Mesh, meshOf, scale, sub } from "./caps.ts"
import { ConnectorsFile, type End } from "./connectorsFile.ts"
import { keepOrder, surveyedPieces, surveyMesh } from "./connectorSurvey.ts"
import { loadTriangles, type Vec } from "./glb.ts"
import { nth } from "./nth.ts"
import { readJson } from "./readJson.ts"

const repo = join(import.meta.dirname, "..", "..", "..")
const meshRoot = existsSync(join(repo, "assets", "pieces")) ? join(repo, "assets") : join(repo, "web-assets")
const catalog = readJson(Catalog, "..", "..", "assets", "catalog.json")
const index = indexCatalog(catalog)
const measured = readJson(ConnectorsFile, "connectors.json").pieces

const pieceOf = (className: string) => {
  const piece = catalog.pieces.find((p) => p.className === className)
  if (piece?.glb == null) throw new Error(`${className} has no mesh`)
  return { piece, glb: piece.glb }
}

/** Every surveyed piece's mesh, loaded once for all the checks. */
const meshes = new Map(
  await Promise.all(
    surveyedPieces(catalog).map(async ({ glb }) => {
      const path = join(meshRoot, glb)
      if (!existsSync(path)) throw new Error(`${path} is missing: run \`pnpm assets\` for the asset pack`)
      return [glb, meshOf(await loadTriangles(path))] as const
    })
  )
)
const meshOfPiece = (className: string) => {
  const { glb } = pieceOf(className)
  const mesh = meshes.get(glb)
  if (mesh === undefined) throw new Error(`${className} isn't a surveyed piece`)
  return mesh
}

const toVec = ({ x, y, z }: { readonly x: number; readonly y: number; readonly z: number }): Vec => [x, y, z]
const fromVec = ([x, y, z]: Vec) => ({ x, y, z })

/** The rim of the cap `end` is cut by: the cap in its plane whose middle is the end's cap's middle. */
const rimOf = (mesh: Mesh, end: End) => {
  const middle = end.cap.centre ?? end.position
  const candidates = capsOf(mesh).filter((face) =>
    dot(face.normal, end.forward) > 0.9999 && Math.abs(face.offset - dot(end.position, end.forward)) < 0.05
  )
  const nearest = candidates.map((face) => ({ face, measure: measureCap(mesh, face, end.up) }))
    .sort((a, b) => Math.hypot(...sub(a.measure.centre, middle)) - Math.hypot(...sub(b.measure.centre, middle)))[0]
  if (nearest === undefined) throw new Error(`no cap at ${end.position.join(", ")}`)
  return nearest.measure.rim
}

const segmentDistance = (p: Vec, a: Vec, b: Vec) => {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)))
  return Math.hypot(...sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]))
}
/** How far the farthest of `points` is from the rim `loops` draws. */
const farthestFrom = (points: ReadonlyArray<Vec>, loops: ReadonlyArray<ReadonlyArray<Vec>>) =>
  Math.max(
    0,
    ...points.map((p) =>
      Math.min(...loops.flatMap((loop) => loop.map((a, i) => segmentDistance(p, a, nth(loop, (i + 1) % loop.length)))))
    )
  )

/** How deep an end's cap is along its up. */
const capDepth = (end: End) => ("height" in end.cap ? end.cap.height : 2 * end.cap.radius)
/** The top of an end's cap: its position, unless the end is anchored on the cap's middle. */
const capTop = (end: End): Vec =>
  end.cap.centre === undefined ? add(end.position, scale(end.up, capDepth(end) / 2)) : end.position

/**
 * Pieces whose mesh doesn't hold to these checks, and why: the game has to show what they do (docs/qa/connectors.md
 * § Not confirmed in the game). They keep their ends; the checks skip them.
 */
const UNEVEN: Readonly<Record<string, string>> = {
  BP_Pipe_Quarter_Small: "its +X end faces 5° off the X axis, and its two caps differ by 2.6 cm at the wall's foot"
}

const ends = Object.entries(measured).flatMap(([className, list]) =>
  UNEVEN[className] === undefined ? list.map((end, number) => ({ className, end, number })) : []
)

describe("connectors.json against the meshes", () => {
  it("is what the survey reads off them", { timeout: 300_000 }, () => {
    const surveyed: Record<string, ReadonlyArray<End>> = {}
    for (const { className } of surveyedPieces(catalog)) {
      const found = surveyMesh(meshOfPiece(className), className).ends
      if (found.length > 0) surveyed[className] = keepOrder(found, measured[className] ?? [])
    }
    assert.deepStrictEqual(surveyed, measured)
  })

  it(
    "has every end at the front of its piece: nothing of it stands ahead of the cap",
    { timeout: 300_000 },
    () => {
      const ahead: Array<string> = []
      for (const { className, end, number } of ends) {
        const mesh = meshOfPiece(className)
        const middle = end.cap.centre ?? end.position
        const right = cross(end.up, end.forward)
        const over = (p: Vec) => {
          const d = sub(p, middle)
          const [r, u] = [dot(d, right), dot(d, end.up)]
          return "radius" in end.cap
            ? Math.hypot(r, u) < end.cap.radius - 0.5
            : Math.abs(r) < end.cap.width / 2 - 0.5 && Math.abs(u) < end.cap.height / 2 - 0.5
        }
        const front = Math.max(...mesh.points.filter(over).map((p) => dot(sub(p, end.position), end.forward)))
        if (front > 0.05) ahead.push(`${className} end ${number}: ${front.toFixed(2)} cm`)
      }
      assert.deepStrictEqual(ahead, [])
    }
  )

  const profiles = [...new Set(ends.map(({ end }) => end.profile))]
  for (const profile of profiles) {
    it(`joins ${profile} ends cap to cap`, { timeout: 300_000 }, () => {
      const ofProfile = ends.filter(({ end }) => end.profile === profile)
      const placedAt = (className: string, transform: ItemTransform) =>
        endsOf(className, itemFromPiece(pieceOf(className).piece, transform), transform, index)
      const misses: Array<string> = []
      for (const joining of ofProfile) {
        // The end it joins: the profile's first, or for a lopsided profile its first of the other hand.
        const target = ofProfile.find(({ end }) => end.hand === undefined || end.hand !== joining.end.hand)
        if (target === undefined) continue
        const still = nth(placedAt(target.className, identityTransform()), target.number)
        const own = nth(placedAt(joining.className, identityTransform()), joining.number)
        const rotation = meetingTurn(own, still)
        const turned = rotateVec(rotation, fromVec(joining.end.position))
        const transform = Schema.decodeUnknownSync(ItemTransform)({
          rotation,
          translation: fromVec(sub(toVec(still.position), toVec(turned))),
          scale3D: { x: 1, y: 1, z: 1 }
        })
        const moved: WorldEnd = nth(placedAt(joining.className, transform), joining.number)
        if (!endsMeet({ ...still, ref: { item: "still", end: 0 } }, { ...moved, ref: { item: "moved", end: 0 } })) {
          misses.push(
            `${joining.className} end ${joining.number} doesn't meet ${target.className} end ${target.number}`
          )
          continue
        }
        // The two rims, in the still piece's frame: all of them when the caps are as deep, else the top half of the
        // shallower one, as a deeper cap of the same profile only shares the top (Bevel_F Cap's, a tall bevel's).
        const depth = Math.min(capDepth(target.end), capDepth(joining.end))
        const shared = Math.abs(capDepth(target.end) - capDepth(joining.end)) < 0.5 ? depth + 1 : depth / 2
        const top = capTop(target.end)
        const within = (p: Vec) => dot(sub(p, top), target.end.up) >= -shared
        const stillRim = rimOf(meshOfPiece(target.className), target.end)
        const movedRim = rimOf(meshOfPiece(joining.className), joining.end)
          .map((loop) => loop.map((p) => toVec(localToWorld(transform, fromVec(p)))))
        const off = Math.max(
          farthestFrom(movedRim.flat().filter(within), stillRim),
          farthestFrom(stillRim.flat().filter(within), movedRim)
        )
        if (off > 0.05) misses.push(`${joining.className} end ${joining.number}: rims ${off.toFixed(2)} cm apart`)
      }
      assert.deepStrictEqual(misses, [])
    })
  }
})
