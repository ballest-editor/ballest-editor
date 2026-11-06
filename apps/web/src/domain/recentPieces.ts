/** The Pieces panel's Recent and Favourites: lists of `pieceIdOf` ids, kept in settings. */

/** How many pieces Recent holds. */
export const RECENT_PIECES = 8

/** `recent` with `id` at the front, once, and the oldest gone past the limit. */
export const withRecentPiece = (recent: ReadonlyArray<string>, id: string): ReadonlyArray<string> =>
  [id, ...recent.filter((other) => other !== id)].slice(0, RECENT_PIECES)

/** `favourites` with `id` starred at the end, or with its star taken off. */
export const withFavouriteToggled = (favourites: ReadonlyArray<string>, id: string): ReadonlyArray<string> =>
  favourites.includes(id) ? favourites.filter((other) => other !== id) : [...favourites, id]
