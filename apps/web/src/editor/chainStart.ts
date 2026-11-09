/**
 * The mark on a selected chain's first link: a "Link 1" label at its pivot, a steady size on screen and drawn over
 * everything. Link 1 is the end that stays put, where a bend, spread or stretch runs from, and what Reverse swaps for
 * the other end (docs/DESKTOP.md § Group pivots and chains).
 */
import * as THREE from "three"
import { SIZE } from "./gizmo/handles"
import { LABEL_HEIGHT, labelTexture } from "./labelTexture"

export const CHAIN_START_TEXT = "Link 1"
/** Up and to the right of the pivot, in the label's own widths and heights, clear of the pivot's dot. */
const BESIDE = new THREE.Vector2(-0.12, -0.4)
/** How far under the point the label's top goes when the gizmo sits there, past the gizmo's reach, in pixels. */
const UNDER_GIZMO = SIZE.axisStart + SIZE.axisLength + 8
/** Over the pivot dots, under the gizmo. */
const RENDER_ORDER = 910

/** Put it in the scene, then `update` it before each pane draws. Never raycast. */
export class ChainStart extends THREE.Sprite {
  private readonly width: number

  constructor() {
    const { texture, width } = labelTexture(CHAIN_START_TEXT)
    super(
      new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        toneMapped: false
      })
    )
    this.width = width
    this.renderOrder = RENDER_ORDER
    this.frustumCulled = false
    this.raycast = () => {}
  }

  /**
   * Places it at `origin` (scene space) for a pane showing `worldPerPixel` cm to the pixel there: beside the point, or
   * centred under the gizmo, a caption for it, when the gizmo sits there `gizmoScale` times its usual size.
   */
  update(origin: THREE.Vector3, worldPerPixel: number, gizmoScale: number | undefined): void {
    this.position.copy(origin)
    if (gizmoScale === undefined) this.center.copy(BESIDE)
    else this.center.set(0.5, 1 + UNDER_GIZMO * gizmoScale / LABEL_HEIGHT)
    this.scale.set(this.width * worldPerPixel, LABEL_HEIGHT * worldPerPixel, 1)
    this.updateMatrixWorld(true)
  }

  /** The texture is shared (`labelTexture`), so only the material goes. */
  override dispose(): void {
    this.material.dispose()
    super.dispose()
  }
}
