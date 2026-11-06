/**
 * A piece dragged from the Pieces panel to the viewport. A drag's data can't be read until the drop, and the ghost needs
 * the piece on the way there, so the piece is kept here and the data only says what kind of drag this is.
 */
import { type CatalogPiece, pieceIdOf } from "../domain/Catalog"

const PIECE_DRAG_TYPE = "application/x-ballest-piece"

/** A one-pixel transparent gif. */
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

let dragged: CatalogPiece | undefined
let blank: HTMLImageElement | undefined

const blankImage = () => {
  blank ??= Object.assign(new Image(), { src: BLANK_IMAGE })
  return blank
}

/** Starts the drag with no image of the browser's: the ghost is ours (components/DropGhost.tsx). */
export const startPieceDrag = (transfer: DataTransfer, piece: CatalogPiece) => {
  dragged = piece
  transfer.effectAllowed = "copy"
  transfer.setData(PIECE_DRAG_TYPE, pieceIdOf(piece))
  transfer.setDragImage(blankImage(), 0, 0)
}

export const endPieceDrag = () => {
  dragged = undefined
}

export const isPieceDrag = (transfer: DataTransfer): boolean => transfer.types.includes(PIECE_DRAG_TYPE)

/** The piece on its way to the viewport, if one is. */
export const draggedPiece = (): CatalogPiece | undefined => dragged
