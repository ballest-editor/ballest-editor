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

export type Glyph = typeof IconBox

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

/** The two items a map is built around, which read better as a mark than as a 16px picture. */
const OWN_GLYPHS: ReadonlyMap<string, Glyph> = new Map([
  [PLAYER_START_CLASS, IconMapPin],
  [GOAL_CLASS, IconTarget]
])

/** Whether an item's row shows its own glyph and never a thumbnail. */
export const hasOwnGlyph = (actorClass: string): boolean => OWN_GLYPHS.has(actorClass)

/** An item's glyph in the Outline: its own if it has one, else its piece category's, else a generic box. */
export const itemGlyphOf = (actorClass: string, category: string | null | undefined): Glyph =>
  OWN_GLYPHS.get(actorClass) ?? CATEGORY_GLYPHS.get(category ?? "") ?? IconBox
