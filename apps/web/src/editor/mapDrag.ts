/** A map dragged from the Project panel to the tab strip. */
import { isMapFileName } from "@ballest/contracts"

const MAP_DRAG_TYPE = "application/x-ballest-map"

export const startMapDrag = (transfer: DataTransfer, fileName: string) => {
  transfer.effectAllowed = "copy"
  transfer.setData(MAP_DRAG_TYPE, fileName)
}

export const isMapDrag = (transfer: DataTransfer): boolean => transfer.types.includes(MAP_DRAG_TYPE)

/** The project map a drop carries; undefined for anything else. */
export const droppedMap = (transfer: DataTransfer): string | undefined => {
  const fileName = transfer.getData(MAP_DRAG_TYPE)
  return isMapFileName(fileName) ? fileName : undefined
}
