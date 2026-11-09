/** A pane as snapping sees it: distances in its pixels, rays and points in game space. The meeting of `SnapView` and three. */
import * as THREE from "three"
import { threeToUeVector, ueToThreeVector, type Vec3 } from "../../domain/coords"
import type { Box } from "../../domain/itemBounds"
import type { Ray, ScreenPoint, SnapView } from "../../domain/snapFrame"
import type { PaneCamera } from "../paneCameras"

export const toThree = (v: Vec3): THREE.Vector3 => {
  const { x, y, z } = ueToThreeVector(v)
  return new THREE.Vector3(x, y, z)
}

export const toGame = (v: THREE.Vector3): Vec3 => threeToUeVector({ x: v.x, y: v.y, z: v.z })

export const gameRayOf = (ray: { readonly origin: THREE.Vector3; readonly direction: THREE.Vector3 }): Ray => ({
  origin: toGame(ray.origin),
  direction: toGame(ray.direction)
})

const threeBoxOf = ({ max, min }: Box) => new THREE.Box3().setFromPoints([toThree(min), toThree(max)])

export const snapViewOf = (pane: PaneCamera): SnapView => {
  const { camera } = pane
  const raycaster = new THREE.Raycaster()
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  )
  const forward = camera.getWorldDirection(new THREE.Vector3())
  const rayAt = ({ x, y }: ScreenPoint): Ray => {
    raycaster.setFromCamera(new THREE.Vector2((x / pane.width) * 2 - 1, -(y / pane.height) * 2 + 1), camera)
    return gameRayOf(raycaster.ray)
  }
  return {
    project: (point) => {
      const at = toThree(point)
      if (pane.view === undefined && at.clone().sub(camera.position).dot(forward) <= 0) return undefined
      at.project(camera)
      return { x: ((at.x + 1) / 2) * pane.width, y: ((1 - at.y) / 2) * pane.height }
    },
    rayAt,
    cmPerPixelAt: (point) => pane.worldPerPixelAt(toThree(point)),
    directionAt: (point) =>
      toGame(pane.view === undefined ? toThree(point).sub(camera.position).normalize() : forward.clone()),
    orthographic: pane.view !== undefined,
    inView: (box) => frustum.intersectsBox(threeBoxOf(box))
  }
}
