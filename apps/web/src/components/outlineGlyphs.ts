import {
  IconAlertTriangle,
  IconAngle,
  IconBowl,
  IconBox,
  IconBulb,
  IconCategory,
  IconCylinder,
  IconFlag,
  IconMapPin,
  IconPackage,
  IconPipeline,
  IconRoad,
  IconShape,
  IconSparkles,
  IconSticker,
  IconTarget,
  IconTrees
} from "@tabler/icons-react"
import { GOAL_CLASS, PLAYER_START_CLASS } from "../domain/MapFile"

type Glyph = typeof IconBox

/** One per in-game category, as `assets/catalog.json` names them. */
const CATEGORY_GLYPHS: ReadonlyMap<string, Glyph> = new Map([
  ["Bowls", IconBowl],
  ["Decals", IconSticker],
  ["Hazards", IconAlertTriangle],
  ["Lights", IconBulb],
  ["Misc", IconCategory],
  ["Objectives", IconFlag],
  ["Pipes", IconPipeline],
  ["Props", IconPackage],
  ["Ramps", IconAngle],
  ["Scenery", IconTrees],
  ["Shapes", IconShape],
  ["Special", IconSparkles],
  ["Tracks", IconRoad],
  ["Tubes", IconCylinder]
])

/** An item's glyph in the Outline: the player start's, the goal's, else its piece category's, else a generic box. */
export const itemGlyphOf = (actorClass: string, category: string | null | undefined): Glyph => {
  if (actorClass === PLAYER_START_CLASS) return IconMapPin
  if (actorClass === GOAL_CLASS) return IconTarget
  return CATEGORY_GLYPHS.get(category ?? "") ?? IconBox
}
