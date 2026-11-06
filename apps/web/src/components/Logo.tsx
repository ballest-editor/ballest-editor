/** The app's mark, the favicon's file. The product's name stands beside it, so it has no alt text of its own. */
export function Logo({ className }: { readonly className: string }) {
  return <img src="/favicon.svg" alt="" draggable={false} className={className} />
}
