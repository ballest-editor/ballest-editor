import type { PlacementView } from "../domain/placement"

/** Straight down at the floor, with +X up the screen and everything in sight. */
export const VIEW_DOWN: PlacementView = {
  position: { x: 2000, y: 0, z: 3000 },
  right: { x: 0, y: 1, z: 0 },
  up: { x: 1, y: 0, z: 0 },
  project: () => ({ x: 0, y: 0, z: 0 })
}
