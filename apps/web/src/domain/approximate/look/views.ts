/**
 * How an approximation looks, not just what it fills: the model and the pieces drawn from twelve fixed directions by a
 * small software rasterizer, and compared picture by picture. Voxel measures can't tell a regular stair-step from a
 * cone poking out at an odd angle, and they don't see which way a surface faces, which is what shading shows.
 *
 * Each view is orthographic and framed on the model's bounding sphere, so the model and the pieces land on the same
 * pixels. A picture keeps, per pixel, whether something is there (the silhouette), how near it is, and the direction
 * of the nearest face, turned toward the viewer since a face shades the same seen from either side. Pieces are drawn
 * from the shapes the fitters use (shapes.ts), tessellated about as finely as the game's meshes.
 */
import { rotationMatrix } from "../grid/raster"
import { at, trianglesBox } from "../grid/voxelize"
import type { Placement, ShapeKind } from "../shapes"

/** Pixels on a side of each view. */
const VIEW_SIZE = 256

type Triple = readonly [number, number, number]

const unit = (x: number, y: number, z: number): Triple => {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/** From the model toward the camera: the eight corners of a cube, then four round the equator. */
const VIEW_DIRECTIONS: ReadonlyArray<Triple> = [
  ...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => unit(x, y, z)))),
  unit(1, 0, 0),
  unit(0, 1, 0),
  unit(-1, 0, 0),
  unit(0, -1, 0)
]

/** Where the views look: the middle of the model's box, and the radius of the sphere round it. */
interface ViewFrame {
  readonly centre: Triple
  readonly radius: number
}

export const viewFrameOf = (triangles: Float32Array): ViewFrame => {
  const { max, min } = trianglesBox(triangles)
  return {
    centre: [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2],
    radius: Math.max(1e-6, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2)
  }
}

interface Camera {
  readonly toward: Triple
  readonly right: Triple
  readonly up: Triple
}

const cross = (a: Triple, b: Triple): Triple =>
  unit(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

/** Z stays up on screen, except looking straight down or up. */
const cameraOf = (toward: Triple): Camera => {
  const worldUp: Triple = Math.abs(toward[2]) > 0.99 ? [1, 0, 0] : [0, 0, 1]
  const right = cross(worldUp, toward)
  return { toward, right, up: cross(toward, right) }
}

/** One view: per pixel, row by row, whether something is there, how near, and its face's direction. */
export interface Picture {
  readonly size: number
  readonly mask: Uint8Array
  /** How far toward the camera from the frame's centre, in cm; -Infinity with nothing there. */
  readonly depth: Float32Array
  /** x, y, z per pixel, turned toward the viewer. */
  readonly normals: Float32Array
}

const emptyPicture = (size: number): Picture => ({
  size,
  mask: new Uint8Array(size * size),
  depth: new Float32Array(size * size).fill(-Infinity),
  normals: new Float32Array(size * size * 3)
})

const copyOf = (picture: Picture): Picture => ({
  size: picture.size,
  mask: picture.mask.slice(),
  depth: picture.depth.slice(),
  normals: picture.normals.slice()
})

/** Draws `triangles` (nine numbers each, cm) into `picture`. The nearer surface wins a pixel, the first drawn a tie. */
const draw = (picture: Picture, frame: ViewFrame, camera: Camera, triangles: Float32Array) => {
  const { size } = picture
  const scale = size / (2 * frame.radius)
  const [cx, cy, cz] = frame.centre
  const { right, toward, up } = camera
  // The three corners on screen, in pixels, and how far each is toward the camera.
  const sx = new Float64Array(3), sy = new Float64Array(3), sz = new Float64Array(3)
  for (let t = 0; t < triangles.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      const x = at(triangles, t + 3 * k) - cx,
        y = at(triangles, t + 3 * k + 1) - cy,
        z = at(triangles, t + 3 * k + 2) - cz
      sx[k] = (x * right[0] + y * right[1] + z * right[2]) * scale + size / 2
      sy[k] = size / 2 - (x * up[0] + y * up[1] + z * up[2]) * scale
      sz[k] = x * toward[0] + y * toward[1] + z * toward[2]
    }
    const x0 = at(sx, 0), x1 = at(sx, 1), x2 = at(sx, 2), y0 = at(sy, 0), y1 = at(sy, 1), y2 = at(sy, 2)
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(area) < 1e-9) continue
    // The face's direction in the world, turned toward the viewer.
    const ax = at(triangles, t + 3) - at(triangles, t), ay = at(triangles, t + 4) - at(triangles, t + 1)
    const az = at(triangles, t + 5) - at(triangles, t + 2)
    const bx = at(triangles, t + 6) - at(triangles, t), by = at(triangles, t + 7) - at(triangles, t + 1)
    const bz = at(triangles, t + 8) - at(triangles, t + 2)
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
    const length = Math.hypot(nx, ny, nz)
    if (length === 0) continue
    const facing = nx * toward[0] + ny * toward[1] + nz * toward[2] < 0 ? -1 : 1
    nx *= facing / length
    ny *= facing / length
    nz *= facing / length
    // The pixels whose centres the triangle's box holds, then those inside the triangle itself.
    const left = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - 0.5))
    const rightmost = Math.min(size - 1, Math.floor(Math.max(x0, x1, x2) - 0.5))
    const top = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 0.5))
    const bottom = Math.min(size - 1, Math.floor(Math.max(y0, y1, y2) - 0.5))
    for (let py = top; py <= bottom; py++) {
      const y = py + 0.5
      for (let px = left; px <= rightmost; px++) {
        const x = px + 0.5
        const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area
        if (w0 < 0) continue
        const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area
        if (w1 < 0) continue
        const w2 = 1 - w0 - w1
        if (w2 < 0) continue
        const depth = w0 * at(sz, 0) + w1 * at(sz, 1) + w2 * at(sz, 2)
        const i = px + size * py
        if (depth <= at(picture.depth, i)) continue
        picture.depth[i] = depth
        picture.mask[i] = 1
        picture.normals[3 * i] = nx
        picture.normals[3 * i + 1] = ny
        picture.normals[3 * i + 2] = nz
      }
    }
  }
}

/** Every view of the sets of triangles in `sets`, drawn in their order, `size` pixels on a side. */
export const picturesOf = (
  frame: ViewFrame,
  sets: ReadonlyArray<Float32Array>,
  { size = VIEW_SIZE }: { readonly size?: number } = {}
): ReadonlyArray<Picture> =>
  VIEW_DIRECTIONS.map((toward) => {
    const picture = emptyPicture(size)
    const camera = cameraOf(toward)
    for (const triangles of sets) draw(picture, frame, camera, triangles)
    return picture
  })

type Face = readonly [number, number, number]

/** The triangles of `faces`, each three indices into `points`, as one flat array. */
const flatTriangles = (points: ReadonlyArray<Triple>, faces: ReadonlyArray<Face>) =>
  new Float32Array(faces.flatMap((face) => face.flatMap((i) => [...(points[i] ?? [0, 0, 0])])))

/** `count` points round the z axis at `radius` and height `z`, from +X toward +Y. */
const ring = (count: number, radius: number, z: number): ReadonlyArray<Triple> =>
  Array.from({ length: count }, (_, i): Triple => [
    radius * Math.cos(2 * Math.PI * i / count),
    radius * Math.sin(2 * Math.PI * i / count),
    z
  ])

/** The faces between `rows` + 1 rings of `segments` points each, ring after ring: two to a quad. */
const bands = (rows: number, segments: number): ReadonlyArray<Face> => {
  const faces: Array<Face> = []
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < segments; j++) {
      const next = (j + 1) % segments
      const a = i * segments + j, b = (i + 1) * segments + j, c = (i + 1) * segments + next, d = i * segments + next
      faces.push([a, b, d], [b, c, d])
    }
  }
  return faces
}

/** A solid of revolution about z through `profile`'s (radius, z) points, one ring of `segments` points each. */
const revolved = (profile: ReadonlyArray<readonly [number, number]>, segments: number) =>
  flatTriangles(profile.flatMap(([radius, z]) => ring(segments, radius, z)), bands(profile.length - 1, segments))

/** A quarter circle from its side to its pole in `steps`, as (radius, height) pairs. */
const quarterArc = (steps: number): ReadonlyArray<readonly [number, number]> =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const angle = Math.PI / 2 * k / steps
    return [Math.cos(angle), Math.sin(angle)] as const
  })

/** The faces `of` gives for each point `i` of a ring of `count` and the next one round, `j`. */
const roundRing = (count: number, of: (i: number, j: number) => ReadonlyArray<Face>): Array<Face> =>
  Array.from({ length: count }, (_, i) => of(i, (i + 1) % count)).flat()

/** A prism over a ring of `count` points from z = -1 to 1, with a fan over each end. */
const prism = (count: number) => {
  const points = [...ring(count, 1, -1), ...ring(count, 1, 1), [0, 0, -1], [0, 0, 1]] as const
  const low = 2 * count, high = 2 * count + 1
  return flatTriangles(
    points,
    roundRing(
      count,
      (i, j) => [[low, j, i], [i, j, count + j], [i, count + j, count + i], [high, count + i, count + j]]
    )
  )
}

/** A cone over a ring of `count` points at z = -1, its apex at z = 1. */
const cone = (count: number) => {
  const points = [...ring(count, 1, -1), [0, 0, -1], [0, 0, 1]] as const
  const low = count, apex = count + 1
  return flatTriangles(points, roundRing(count, (i, j) => [[low, j, i], [i, j, apex]]))
}

const box = () => {
  const corners = Array.from({ length: 8 }, (_, i): Triple => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1])
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]] as const
  return flatTriangles(corners, quads.flatMap(([a, b, c, d]): Array<Face> => [[a, b, c], [a, c, d]]))
}

const SPHERE_RINGS = 8

/** Each shape's triangles in its normalised box, [-1, 1] on each axis (shapes.ts). */
const unitMeshes: Readonly<Record<ShapeKind, Float32Array>> = {
  box: box(),
  // From the pole at z = 1 down to the one at z = -1.
  sphere: revolved(
    Array.from({ length: SPHERE_RINGS + 1 }, (_, i) => {
      const theta = Math.PI * i / SPHERE_RINGS
      return [Math.sin(theta), Math.cos(theta)] as const
    }),
    16
  ),
  cylinder: prism(16),
  cone: cone(24),
  // The diamond base, then the four sides.
  pyramid: flatTriangles(
    [[1, 0, -1], [0, 1, -1], [-1, 0, -1], [0, -1, -1], [0, 0, 1]],
    [[0, 2, 1], [0, 3, 2], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
  ),
  // The flat face's middle, its rim, then the dome up to its pole: z = -1 to 1 is its height, as tall as it is wide.
  hemisphere: revolved([[0, -1], ...quarterArc(4).map(([r, h]) => [r, 2 * h - 1] as const)], 16),
  // A cap a quarter of the length on each end of a cylinder over the middle half.
  capsule: revolved([
    ...quarterArc(4).toReversed().map(([r, h]) => [r, -0.5 - h / 2] as const),
    ...quarterArc(4).map(([r, h]) => [r, 0.5 + h / 2] as const)
  ], 16)
}

/** A placed piece's triangles in cm. */
export const trianglesOfPlacement = (placement: Placement): Float32Array => {
  const unitMesh = unitMeshes[placement.kind]
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotationMatrix(placement.rotation)
  const { x: hx, y: hy, z: hz } = placement.half
  const { x: cx, y: cy, z: cz } = placement.center
  const triangles = new Float32Array(unitMesh.length)
  for (let i = 0; i < unitMesh.length; i += 3) {
    const x = at(unitMesh, i) * hx, y = at(unitMesh, i + 1) * hy, z = at(unitMesh, i + 2) * hz
    triangles[i] = cx + r00 * x + r01 * y + r02 * z
    triangles[i + 1] = cy + r10 * x + r11 * y + r12 * z
    triangles[i + 2] = cz + r20 * x + r21 * y + r22 * z
  }
  return triangles
}

/** `placements` drawn into every view. */
export const piecePictures = (frame: ViewFrame, placements: ReadonlyArray<Placement>): ReadonlyArray<Picture> =>
  picturesOf(frame, placements.map(trianglesOfPlacement))

/**
 * Copies of `base`, pictures from every view, with `placements` drawn in too: a few pieces can be tried over many
 * without drawing the many again.
 */
export const drawnOver = (
  frame: ViewFrame,
  base: ReadonlyArray<Picture>,
  placements: ReadonlyArray<Placement>
): ReadonlyArray<Picture> => {
  const sets = placements.map(trianglesOfPlacement)
  return base.map((picture, view) => {
    const over = copyOf(picture)
    const camera = cameraOf(VIEW_DIRECTIONS[view] ?? [0, 0, 1])
    for (const triangles of sets) draw(over, frame, camera, triangles)
    return over
  })
}

/**
 * Per view, the pixels within `radius` cm of any of `points` (x, y, z each) on screen, as a square round each: where a
 * part of the model shows, to judge what stands in for it there alone.
 */
export const regionsOf = (frame: ViewFrame, points: Float64Array, radius: number): ReadonlyArray<Uint8Array> =>
  VIEW_DIRECTIONS.map((toward) => {
    const size = VIEW_SIZE
    const scale = size / (2 * frame.radius)
    const { right, up } = cameraOf(toward)
    const [cx, cy, cz] = frame.centre
    const reach = Math.max(1, Math.ceil(radius * scale))
    const region = new Uint8Array(size * size)
    for (let k = 0; k + 2 < points.length; k += 3) {
      const x = at(points, k) - cx, y = at(points, k + 1) - cy, z = at(points, k + 2) - cz
      const px = Math.floor((x * right[0] + y * right[1] + z * right[2]) * scale + size / 2)
      const py = Math.floor(size / 2 - (x * up[0] + y * up[1] + z * up[2]) * scale)
      for (let v = Math.max(0, py - reach); v <= Math.min(size - 1, py + reach); v++) {
        for (let u = Math.max(0, px - reach); u <= Math.min(size - 1, px + reach); u++) region[u + size * v] = 1
      }
    }
    return region
  })

/** A depth jump between neighbouring pixels larger than this many pixel widths is an edge. */
const EDGE_DEPTH_PIXELS = 3

/** So is a turn of the face direction larger than this, in degrees. */
const EDGE_TURN_DEGREES = 25

/**
 * Per pixel of `picture`, 1 where it shows an edge against its right or lower neighbour: one of the two is empty (the
 * outline), or they stand more than `EDGE_DEPTH_PIXELS` apart in depth, or face more than `EDGE_TURN_DEGREES` apart.
 */
export const edgesOf = (picture: Picture, frame: ViewFrame): Uint8Array => {
  const { depth, mask, normals, size } = picture
  const step = EDGE_DEPTH_PIXELS * 2 * frame.radius / size
  const cosine = Math.cos(EDGE_TURN_DEGREES * Math.PI / 180)
  const differs = (i: number, j: number) => {
    if (at(mask, i) !== at(mask, j)) return true
    if (at(mask, i) === 0) return false
    if (Math.abs(at(depth, i) - at(depth, j)) > step) return true
    const dot = at(normals, 3 * i) * at(normals, 3 * j) + at(normals, 3 * i + 1) * at(normals, 3 * j + 1) +
      at(normals, 3 * i + 2) * at(normals, 3 * j + 2)
    return dot < cosine
  }
  const edges = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = x + size * y
      if ((x + 1 < size && differs(i, i + 1)) || (y + 1 < size && differs(i, i + size))) edges[i] = 1
    }
  }
  return edges
}

/** The model's views, drawn once and compared with every approximation of it, and the edges each shows. */
export interface ModelViews {
  readonly frame: ViewFrame
  readonly pictures: ReadonlyArray<Picture>
  readonly edges: ReadonlyArray<Uint8Array>
}

export const modelViews = (triangles: Float32Array): ModelViews => {
  const frame = viewFrameOf(triangles)
  const pictures = picturesOf(frame, [triangles])
  return { frame, pictures, edges: pictures.map((picture) => edgesOf(picture, frame)) }
}

/**
 * Walks the pixels of two pictures from one view, those of `region` alone when given, and calls `shared` where both
 * show a surface, with the dot of their face directions there. Counts the pixels both show and those either does.
 */
const overlap = (
  a: Picture,
  b: Picture,
  region: Uint8Array | undefined,
  shared: (i: number, dot: number) => void
): { readonly both: number; readonly either: number } => {
  let both = 0, either = 0
  for (let i = 0; i < a.mask.length; i++) {
    if (region !== undefined && at(region, i) === 0) continue
    const inA = at(a.mask, i) === 1, inB = at(b.mask, i) === 1
    if (inA || inB) either++
    if (!inA || !inB) continue
    both++
    shared(
      i,
      at(a.normals, 3 * i) * at(b.normals, 3 * i) + at(a.normals, 3 * i + 1) * at(b.normals, 3 * i + 1) +
        at(a.normals, 3 * i + 2) * at(b.normals, 3 * i + 2)
    )
  }
  return { both, either }
}

const countOf = (marks: Uint8Array | undefined): number => {
  let count = 0
  if (marks !== undefined) { for (let i = 0; i < marks.length; i++) count += at(marks, i) }
  return count
}

/** The measures the pictures give (evaluate.ts). */
interface ViewScore {
  /** Silhouette IoU, averaged over the views: 1 is a perfect match. */
  readonly silhouette: number
  /** The mean angle, in degrees, between the model's and the pieces' faces where both show. */
  readonly normalAngle: number
  /**
   * The pieces' edge pixels over the model's, averaged over the views: 1 is as busy as the model, and more is the
   * stair-steps, ragged slabs and stray seams the model doesn't have.
   */
  readonly clutter: number
}

export const compareViews = (model: ModelViews, placements: ReadonlyArray<Placement>): ViewScore => {
  const pieces = piecePictures(model.frame, placements)
  let silhouettes = 0, angles = 0, shared = 0, clutter = 0
  model.pictures.forEach((modelPicture, view) => {
    const picture = pieces[view]
    if (picture === undefined) return
    const { both, either } = overlap(modelPicture, picture, undefined, (_, dot) => {
      angles += Math.acos(Math.min(1, Math.max(-1, dot)))
    })
    silhouettes += either === 0 ? 1 : both / either
    shared += both
    clutter += countOf(edgesOf(picture, model.frame)) / Math.max(1, countOf(model.edges[view]))
  })
  const views = Math.max(1, model.pictures.length)
  return {
    silhouette: silhouettes / views,
    normalAngle: shared === 0 ? 90 : angles / shared * 180 / Math.PI,
    clutter: clutter / views
  }
}

/**
 * How like the model a set of pieces looks, each term from 0 to 1 and averaged over the views: the outline's
 * overlap; how near the pieces' surface is to the model's where both show; and how alike the two face. All three are
 * shares of the pixels either covers, so a missing part costs each of them, and a lump that fills the outline still
 * loses where its surface sits or faces wrong. `score` is their mean. Against 73 pairs of results ranked by eye it
 * orders 71 as the eye does, where outline less face angle and clutter orders 67.
 */
export interface Look {
  readonly silhouette: number
  readonly depth: number
  readonly normal: number
  readonly score: number
}

/** The side of the pictures a look is read from: larger ones are pooled down to it. */
const LOOK_SIZE = 64

/** The depth error, as a share of the frame's radius, at which depth agreement falls to 1/e. */
const DEPTH_REACH = 0.08

/** `picture` at `LOOK_SIZE`, each pixel the nearest surface of those under it; itself when it is no larger. */
const pooled = (picture: Picture): Picture => {
  if (picture.size <= LOOK_SIZE) return picture
  const n = LOOK_SIZE, step = picture.size / n
  const small = emptyPicture(n)
  for (let y = 0; y < picture.size; y++) {
    for (let x = 0; x < picture.size; x++) {
      const i = y * picture.size + x
      if (at(picture.mask, i) === 0) continue
      const j = Math.floor(y / step) * n + Math.floor(x / step)
      if (at(picture.depth, i) <= at(small.depth, j)) continue
      small.mask[j] = 1
      small.depth[j] = at(picture.depth, i)
      small.normals[3 * j] = at(picture.normals, 3 * i)
      small.normals[3 * j + 1] = at(picture.normals, 3 * i + 1)
      small.normals[3 * j + 2] = at(picture.normals, 3 * i + 2)
    }
  }
  return small
}

/** `region`, `full` pixels on a side, at `n` on a side: a pixel is in it when any pixel under it is. */
const pooledRegion = (region: Uint8Array, full: number, n: number): Uint8Array => {
  const small = new Uint8Array(n * n)
  for (let y = 0; y < full; y++) {
    for (let x = 0; x < full; x++) {
      if (at(region, y * full + x) === 1) small[Math.floor(y * n / full) * n + Math.floor(x * n / full)] = 1
    }
  }
  return small
}

const pooledModels = new WeakMap<ModelViews, ReadonlyArray<Picture>>()

/** The model's pictures pooled, worked out once a model. */
const pooledModel = (model: ModelViews): ReadonlyArray<Picture> => {
  const known = pooledModels.get(model)
  if (known !== undefined) return known
  const pictures = model.pictures.map(pooled)
  pooledModels.set(model, pictures)
  return pictures
}

/**
 * One view's three agreements between the model's picture `a` and the pieces' `b`, over `region` alone when given;
 * none when neither shows anything there. `reach` is the depth error, in cm, at which depth agreement is 1/e.
 */
const agreement = (a: Picture, b: Picture, region: Uint8Array | undefined, reach: number) => {
  let facing = 0, near = 0
  const { both, either } = overlap(a, b, region, (i, dot) => {
    facing += Math.max(0, Math.min(1, dot))
    near += Math.exp(-Math.abs(at(a.depth, i) - at(b.depth, i)) / reach)
  })
  return either === 0 ? undefined : { silhouette: both / either, depth: near / either, normal: facing / either }
}

/**
 * The look of `pieces`, pictures from the model's own views and of the model's size, over `regions` alone when given
 * (one a view, of the size of the model's pictures).
 */
export const lookOf = (
  model: ModelViews,
  pieces: ReadonlyArray<Picture>,
  regions?: ReadonlyArray<Uint8Array>
): Look => {
  const reach = model.frame.radius * DEPTH_REACH
  let silhouette = 0, depth = 0, normal = 0, views = 0
  pooledModel(model).forEach((a, view) => {
    const given = pieces[view]
    if (given === undefined) return
    const b = pooled(given)
    if (b.size !== a.size) return
    const region = regions?.[view]
    const full = model.pictures[view]?.size ?? a.size
    const found = agreement(
      a,
      b,
      region !== undefined && full > a.size ? pooledRegion(region, full, a.size) : region,
      reach
    )
    if (found === undefined) return
    views++
    silhouette += found.silhouette
    depth += found.depth
    normal += found.normal
  })
  if (views === 0) return { silhouette: 1, depth: 1, normal: 1, score: 1 }
  silhouette /= views
  depth /= views
  normal /= views
  return { silhouette, depth, normal, score: (silhouette + depth + normal) / 3 }
}

/** The look of `placements` against the model. */
export const lookOfPlacements = (model: ModelViews, placements: ReadonlyArray<Placement>): Look =>
  lookOf(model, piecePictures(model.frame, placements))
