/** Tools › Approximate 3D model (beta): opening the dialog, and its result as a new prefab. */
import { itemsOfPlacements } from "../../domain/approximate/items"
import { type Placement, SHAPES } from "../../domain/approximate/shapes"
import { PREFAB_ITEMS } from "../../domain/gameRules"
import { counted } from "../../domain/groupSelection"
import { ORIGIN } from "../../domain/ueMath"
import { type EditorState, useEditor } from "../store"
import { newPrefabProblem, openUntitledPrefab } from "./prefabs"

export const startApproximate = () => useEditor.getState().openDialog({ id: "approximate" })

/**
 * What every piece of an opened approximation is painted: the Paint picker's smooth White (assets/materials.json), so
 * the prefab reads as one thing, as the preview shows it. Each piece's own paint (a glossy red sphere, metal tiles)
 * would break it up.
 */
const PAINT =
  "/Script/Engine.MaterialInstanceConstant'/Game/Art/Materials/Environment/Materials/Instances_2/MI_Env_White_Smooth.MI_Env_White_Smooth'"

/** Why `placements` can't open as a prefab; undefined when they can. */
export const approximationPrefabProblem = (
  s: EditorState,
  placements: ReadonlyArray<Placement>
): string | undefined => {
  const blocked = newPrefabProblem(s)
  if (blocked !== undefined) return blocked
  if (s.catalogIndex === null) return "The catalog is still loading."
  if (placements.length < PREFAB_ITEMS.min) return `A prefab needs at least ${PREFAB_ITEMS.min} items.`
  if (placements.length > PREFAB_ITEMS.max) {
    return `The game takes at most ${counted(PREFAB_ITEMS.max, "item")} in a prefab: lower the piece budget.`
  }
  const [missing] = itemsOfPlacements(s.catalogIndex, placements, ORIGIN).missing
  return missing === undefined ? undefined : `The catalog has no ${SHAPES[missing].label} piece.`
}

/** A file name as a prefab's: no extension, and only letters, digits and single spaces. */
const prefabNameOf = (fileName: string): string => {
  const name = fileName.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/ +/g, " ").trim()
  return name.length > 0 ? name : "Approximation"
}

/** Opens `placements` as a new, unsaved prefab named after the model's file, and closes the dialog. */
export const openApproximationAsPrefab = (fileName: string, placements: ReadonlyArray<Placement>): void => {
  const s = useEditor.getState()
  if (s.catalogIndex === null || approximationPrefabProblem(s, placements) !== undefined) return
  const { items } = itemsOfPlacements(s.catalogIndex, placements, ORIGIN, PAINT)
  s.closeDialog()
  openUntitledPrefab(prefabNameOf(fileName), items)
}
