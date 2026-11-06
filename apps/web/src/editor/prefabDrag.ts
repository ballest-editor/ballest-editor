/** A prefab dragged from the Prefabs panel to the viewport. */
import { isPrefabName, type PrefabRef } from "@ballest/contracts"

const PREFAB_DRAG_TYPE = "application/x-ballest-prefab"

export const startPrefabDrag = (transfer: DataTransfer, { name, tier }: PrefabRef) => {
  transfer.effectAllowed = "copy"
  transfer.setData(PREFAB_DRAG_TYPE, `${tier}/${name}`)
}

export const isPrefabDrag = (transfer: DataTransfer): boolean => transfer.types.includes(PREFAB_DRAG_TYPE)

/** The prefab a drop carries; undefined for anything else. */
export const droppedPrefab = (transfer: DataTransfer): PrefabRef | undefined => {
  const [tier, name = ""] = transfer.getData(PREFAB_DRAG_TYPE).split("/")
  return (tier === "user" || tier === "project") && isPrefabName(name) ? { tier, name } : undefined
}
