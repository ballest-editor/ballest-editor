/**
 * `Map_LevelEditorMain`, the level every custom map is spawned into. The values come from
 * its cooked assets in the pak (`BallestExtract probe` of
 * `Maps/LevelEditor/Map_LevelEditorMain.umap` and the blueprints it places); see
 * docs/FORMAT.md, "The level". Positions are UE centimetres.
 */
import type { Vec3 } from "./coords"
import { isPlayerStart, type MapFile } from "./MapFile"

/**
 * Where the game puts a new map's player start: the level's own `MP_PlayerStart` (its Main
 * component). Untouched in-game maps keep it here (achievement_creator02, ct4NameBugTest,
 * flow trial, Sway n So).
 */
export const DEFAULT_PLAYER_START: Vec3 = { x: -3955, y: -1785, z: 8615 }

/**
 * Where the game puts a new map's goal ring: the level's own `BP_Checkpoint` (its Main
 * component), 11.65 m along +X from the player start and 2.8 m above it. Untouched in-game
 * maps keep it here (achievement_creator02, Bevel Up, focus, leos).
 */
export const DEFAULT_GOAL: Vec3 = { x: -2790, y: -1863, z: 8896 }

/**
 * The water: `BP_ArenaPieces.Water_Plane`, a flat `SM_WaterTile` (1000 cm square) at scale
 * 200, so a 2 km square sheet at this height. It is opaque in game; anything below it
 * can't be seen from above.
 */
export const WATER = {
  height: 126.71326,
  center: { x: 173, y: -2568.9885 },
  size: 200_000
} as const

/**
 * `BP_KillZone`: a 640 m square box 16 cm thick centred at this height, just under the
 * water. The ball respawns when it touches it.
 */
export const KILL_ZONE_HEIGHT = 100

/**
 * The height the editor builds at: the grid, and where palette pieces land. The level has no
 * floor above the water (the arena's stands are far off), so this is the player start's
 * height, the game's default for a new map.
 */
export const floorHeightOf = (map: MapFile): number =>
  map.items.find(isPlayerStart)?.itemTransform.translation.z ?? DEFAULT_PLAYER_START.z
