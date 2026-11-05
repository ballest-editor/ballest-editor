/** The number that tells apart things of the same name, set off from the name it follows. */
export function Ordinal({ value }: { readonly value: number | undefined }) {
  if (value === undefined) return null
  return <span className="shrink-0 text-[0.65rem] text-muted-foreground tabular-nums">{value}</span>
}
