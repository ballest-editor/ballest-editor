import {
  IconAlertTriangle,
  IconAngle,
  IconBowl,
  IconBox,
  IconBulb,
  IconCategory,
  IconCircleDashed,
  IconCone,
  IconCone2,
  IconCylinder,
  IconFlag,
  IconLamp2,
  IconMapPin,
  IconPackage,
  IconPipeline,
  IconRectangle,
  IconRoad,
  IconShape,
  IconSparkles,
  IconSquareDashed,
  IconSticker,
  IconTarget,
  IconTrees
} from "@tabler/icons-react"
import type { CatalogPiece } from "../domain/Catalog"
import { GOAL_CLASS, PLAYER_START_CLASS } from "../domain/MapFile"

export type Glyph = typeof IconBox

type Piece = Pick<CatalogPiece, "category" | "className">

/** One per in-game category but Lights, whose pieces have one each, as `assets/catalog.json` names them. */
const CATEGORY_GLYPHS: ReadonlyMap<string, Glyph> = new Map([
  ["Bowls", IconBowl],
  ["Decals", IconSticker],
  ["Hazards", IconAlertTriangle],
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

/** The real lights are their fixtures; a light card is a painted glow, so it's the shape it fakes, cones or dashed. */
const LIGHT_GLYPHS: ReadonlyMap<string, Glyph> = new Map([
  ["MP_RawPointLight", IconBulb],
  ["MP_RawSpotLight", IconLamp2],
  ["MP_RawRectLight", IconRectangle],
  ["MP_LightCard_01", IconCone],
  ["MP_LightCard_02", IconCone2],
  ["MP_LightCard_03", IconCircleDashed],
  ["MP_LightCard_04", IconSquareDashed]
])

/** What a light shows wherever a piece has a picture, or undefined for any other piece. */
export const lightGlyphOf = ({ category, className }: Piece): Glyph | undefined =>
  category === "Lights" ? LIGHT_GLYPHS.get(className) ?? IconBulb : undefined

/** Whether an item's row shows its own glyph and never a thumbnail. */
export const hasOwnGlyph = (actorClass: string, piece: Piece | undefined): boolean =>
  OWN_GLYPHS.has(actorClass) || (piece !== undefined && lightGlyphOf(piece) !== undefined)

/** An item's glyph in the Outline: its own if it has one, else its piece category's, else a generic box. */
export const itemGlyphOf = (actorClass: string, piece: Piece | undefined): Glyph =>
  OWN_GLYPHS.get(actorClass) ?? (piece === undefined ? undefined : lightGlyphOf(piece)) ??
    CATEGORY_GLYPHS.get(piece?.category ?? "") ?? IconBox
