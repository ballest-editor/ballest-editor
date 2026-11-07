/**
 * Joints (docs/SNAPPING.md § Connectors): pairs of ends that met when a connector snap committed. They are a record, and
 * hold nothing together. A joint goes when its ends stop meeting or either item goes.
 */
import { endsMeet, type WorldEnd } from "./connectors"
import type { EndRef, Joint } from "./MapSidecar"

const sameEnd = (a: EndRef, b: EndRef) => a.item === b.item && a.end === b.end

const sameJoint = (a: Joint, b: Joint) =>
  (sameEnd(a.a, b.a) && sameEnd(a.b, b.b)) || (sameEnd(a.a, b.b) && sameEnd(a.b, b.a))

/**
 * `joints` after the items `moved` went where `ends` (every end of the map) say: the ones that still meet, and with
 * `connected`, the ends of those items that a connector snap brought onto another's.
 */
export const jointsAfterMove = (
  joints: ReadonlyArray<Joint>,
  ends: ReadonlyArray<WorldEnd>,
  moved: ReadonlySet<string>,
  connected: boolean
): ReadonlyArray<Joint> => {
  const byRef = new Map(ends.map((end) => [`${end.ref.item}:${end.ref.end}`, end]))
  const find = ({ end, item }: EndRef) => byRef.get(`${item}:${end}`)
  const kept = joints.filter((joint) => {
    const [a, b] = [find(joint.a), find(joint.b)]
    return a !== undefined && b !== undefined && endsMeet(a, b)
  })
  if (!connected) return kept
  const met = ends.filter(({ ref }) => moved.has(ref.item)).flatMap((own) =>
    ends.filter((other) => !moved.has(other.ref.item) && endsMeet(own, other))
      .map((other): Joint => ({ a: own.ref, b: other.ref }))
  )
  return [...kept, ...met.filter((joint) => !kept.some((one) => sameJoint(one, joint)))]
}

/** `keys` and everything joints reach from them: the whole track. */
export const connectedKeys = (joints: ReadonlyArray<Joint>, keys: ReadonlyArray<string>): ReadonlySet<string> => {
  const neighbours = new Map<string, Array<string>>()
  const link = (from: string, to: string) => {
    const list = neighbours.get(from)
    if (list === undefined) neighbours.set(from, [to])
    else list.push(to)
  }
  for (const { a, b } of joints) {
    link(a.item, b.item)
    link(b.item, a.item)
  }
  const reached = new Set(keys)
  const waiting = [...keys]
  for (let key = waiting.pop(); key !== undefined; key = waiting.pop()) {
    for (const next of neighbours.get(key) ?? []) {
      if (!reached.has(next)) {
        reached.add(next)
        waiting.push(next)
      }
    }
  }
  return reached
}
