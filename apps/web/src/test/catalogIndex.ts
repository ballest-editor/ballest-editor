/** A catalog index holding one piece, for tests of what a piece's data does. */
import { Schema } from "effect"
import fixture from "../domain/bundledCatalog.json"
import { Catalog, type CatalogIndex, type CatalogPiece, indexCatalog } from "../domain/Catalog"

/** The bundled catalog's first piece with `extra` on top, and an index that finds it. */
export const emptyIndexWith = (
  extra: Record<string, unknown>
): { readonly index: CatalogIndex; readonly piece: CatalogPiece } => {
  const catalog = Schema.decodeUnknownSync(Catalog)(fixture)
  const [first] = catalog.pieces
  if (first === undefined) throw new Error("the bundled catalog has no pieces")
  const piece =
    Schema.decodeUnknownSync(Catalog)({ ...fixture, pieces: [{ ...fixture.pieces[0], ...extra }] }).pieces[0]
  if (piece === undefined) throw new Error("no piece")
  return { index: indexCatalog({ ...catalog, pieces: [piece] }), piece }
}
