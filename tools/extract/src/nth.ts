// Indexing for indices the code worked out itself (a triangle's corners, a loop's next point): one out of range is a
// bug, so it throws rather than hand back undefined.
export const nth = <T>(list: ArrayLike<T>, i: number): T => {
  const value = list[i]
  if (value === undefined) throw new RangeError(`index ${i} of ${list.length}`)
  return value
}
