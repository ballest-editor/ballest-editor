/** The Pieces panel's Recent and Favorites: lists of `pieceIdOf` ids, kept in settings. */

/** How many pieces Recent holds. */
export const RECENT_PIECES = 8

/** `recent` with `id` at the front, once, and the oldest gone past the limit. */
export const withRecentPiece = (recent: ReadonlyArray<string>, id: string): ReadonlyArray<string> =>
  [id, ...recent.filter((other) => other !== id)].slice(0, RECENT_PIECES)

/** `favorites` with `id` starred at the end, or with its star taken off. */
export const withFavoriteToggled = (favorites: ReadonlyArray<string>, id: string): ReadonlyArray<string> =>
  favorites.includes(id) ? favorites.filter((other) => other !== id) : [...favorites, id]
