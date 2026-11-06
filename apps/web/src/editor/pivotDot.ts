/**
 * The dot at a pivot (#82): a disc in the scene at the point a selection turns and scales about, a steady size on
 * screen, facing the camera, drawn over everything so a pivot on a far face still shows. Solid when the pivot is on
 * the outside of what it belongs to, dotted when it sits inside its unit's box, where the piece would otherwise hide
 * it. Each draws one per unit; Together one, at the selection's pivot (docs/design/pivot-modes-and-chains.md § Showing it).
 */
import * as THREE from "three"

/** On screen, in pixels. */
const RADIUS = 4.5
const RING_RADIUS = 5
const RING_DASHES = 8
/** Over the scene, outlines and group boxes, under the gizmo. */
const RENDER_ORDER = 900

const COLORS = { dark: "#ffffff", light: "#1f2430" } as const

const dashedRing = (): THREE.BufferGeometry => {
  const points: Array<number> = []
  const segmentsPerDash = 4
  const dashArc = Math.PI / RING_DASHES
  for (let dash = 0; dash < RING_DASHES; dash++) {
    const from = dash * 2 * dashArc
    for (let i = 0; i < segmentsPerDash; i++) {
      const a0 = from + (dashArc * i) / segmentsPerDash
      const a1 = from + (dashArc * (i + 1)) / segmentsPerDash
      points.push(Math.cos(a0) * RING_RADIUS, Math.sin(a0) * RING_RADIUS, 0)
      points.push(Math.cos(a1) * RING_RADIUS, Math.sin(a1) * RING_RADIUS, 0)
    }
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
}

/** One dot: put it in the scene, then `update` it before each pane draws. Never raycast. */
export class PivotDot extends THREE.Group {
  private readonly disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  private readonly ring: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>

  constructor() {
    super()
    const common = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false } as const
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 24), new THREE.MeshBasicMaterial({ ...common }))
    this.ring = new THREE.LineSegments(dashedRing(), new THREE.LineBasicMaterial({ ...common }))
    for (const part of [this.disc, this.ring]) {
      part.renderOrder = RENDER_ORDER
      part.frustumCulled = false
      part.raycast = () => {}
      this.add(part)
    }
    this.raycast = () => {}
  }

  setDark(dark: boolean): void {
    const color = COLORS[dark ? "dark" : "light"]
    this.disc.material.color.set(color)
    this.ring.material.color.set(color)
  }

  /** Places the dot at `origin` (scene space), `worldPerPixel` big, facing `cameraQuaternion`; `inside` makes it dotted. */
  update(origin: THREE.Vector3, worldPerPixel: number, cameraQuaternion: THREE.Quaternion, inside: boolean): void {
    this.position.copy(origin)
    this.scale.setScalar(worldPerPixel)
    this.quaternion.copy(cameraQuaternion)
    this.disc.visible = !inside
    this.ring.visible = inside
    this.updateMatrixWorld(true)
  }

  override dispose(): void {
    this.disc.geometry.dispose()
    this.disc.material.dispose()
    this.ring.geometry.dispose()
    this.ring.material.dispose()
    super.dispose()
  }
}
