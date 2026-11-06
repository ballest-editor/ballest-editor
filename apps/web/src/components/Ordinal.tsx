/** The number that tells apart things of the same name, set off from the name it follows. */
export function Ordinal({ value }: { readonly value: number | undefined }) {
  if (value === undefined) return null
  return <span className="shrink-0 text-caption text-fg-tertiary tabular-nums">{value}</span>
}
