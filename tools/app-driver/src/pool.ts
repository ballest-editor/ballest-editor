// oxlint-disable eslint/no-await-in-loop -- each worker takes one item at a time; the workers are what run in parallel

/** Runs `work` over `items`, at most `size` at once, and returns the results in the items' order. */
export const inPool = async <A, B>(
  items: ReadonlyArray<A>,
  size: number,
  work: (item: A) => Promise<B>
): Promise<ReadonlyArray<B>> => {
  const results = new Map<number, B>()
  const queue = [...items.entries()]
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      results.set(next[0], await work(next[1]))
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, size) }, worker))
  return [...results.entries()].sort(([a], [b]) => a - b).map(([, result]) => result)
}
