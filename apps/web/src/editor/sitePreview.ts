/**
 * The upload's view of a prefab for its picture on ballestrecords.com (components/SiteAnglePicker.tsx): the definition
 * drawn on a canvas of its own with the thumbnails' lights, turned, zoomed and panned with orbit controls, and read back
 * as the site's angle (`siteAngle.ts`) with a PNG of it.
 */
import type { SiteUploadView } from "@ballest/contracts"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { CatalogIndex } from "../domain/Catalog"
import type { Tuple3 } from "../domain/coords"
import type { Item } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import { angleOf, DEFAULT_SITE_ANGLE, framingOf, SITE_VIEW_FOV } from "./siteAngle"
import { buildDefinition, litScene } from "./thumbnails"

export interface SitePreview {
  /** Back to the site's default view. */
  readonly reset: () => void
  /** The view as it is now, and a PNG of it. */
  readonly take: () => SiteUploadView
  readonly dispose: () => void
}

const tupleOf = (v: THREE.Vector3): Tuple3 => [v.x, v.y, v.z]

/**
 * `items` on `canvas` (`size` css px square), framed at the site's default view; undefined when they draw nothing, or
 * `cancelled()` says the preview went away while they were built.
 */
export const mountSitePreview = async (
  canvas: HTMLCanvasElement,
  size: number,
  items: ReadonlyArray<Item>,
  index: CatalogIndex,
  table: MaterialTable,
  cancelled: () => boolean
): Promise<SitePreview | undefined> => {
  const group = await buildDefinition(items, index, table)
  if (group === undefined || cancelled()) return undefined
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(size, size, false)
  renderer.setClearColor(0x000000, 0)
  const scene = litScene()
  scene.add(group)
  const box = new THREE.Box3().setFromObject(group)
  const centre = tupleOf(box.getCenter(new THREE.Vector3()))
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
  // the site's planes, so what is cut off here is cut off there
  const camera = new THREE.PerspectiveCamera(
    SITE_VIEW_FOV,
    1,
    Math.max(0.05, radius / 2000),
    Math.max(2000, radius * 200)
  )
  const controls = new OrbitControls(camera, canvas)
  const draw = () => renderer.render(scene, camera)
  controls.addEventListener("change", draw)
  const reset = () => {
    const { position, target } = framingOf(DEFAULT_SITE_ANGLE, centre, radius, 1)
    camera.position.set(...position)
    controls.target.set(...target)
    controls.update()
    draw()
  }
  reset()
  return {
    reset,
    take: () => {
      draw()
      return {
        angle: angleOf(tupleOf(camera.position), tupleOf(controls.target), centre, radius, 1),
        picture: renderer.domElement.toDataURL("image/png")
      }
    },
    dispose: () => {
      controls.dispose()
      renderer.dispose()
    }
  }
}
