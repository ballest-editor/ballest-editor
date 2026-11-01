import { assert, describe, it } from "@effect/vitest"
import {
  addNotice,
  clearNotices,
  dropNotices,
  markRead,
  mergeNotices,
  type Notice,
  panelSections,
  resolveNotices,
  unreadCount
} from "./notifications"

const notice = (id: string, extra: Partial<Notice> = {}): Notice => ({
  id,
  kind: "info",
  at: "2026-10-31T12:00:00.000Z",
  read: false,
  persistent: false,
  resolvedAt: null,
  ...extra
})
const ids = (log: ReadonlyArray<Notice>) => log.map((n) => n.id)

describe("notifications", () => {
  it("keeps the newest first, at most the limit, and the pinned ones over the oldest", () => {
    const pinned = notice("p", { kind: "gameNotFound", persistent: true })
    let log: ReadonlyArray<Notice> = [pinned]
    for (const id of ["a", "b", "c"]) log = addNotice(log, notice(id), 3)
    assert.deepStrictEqual(ids(log), ["c", "b", "p"])
  })

  it("replaces a pinned notification of the same kind, and resolving unpins it", () => {
    const first = notice("p1", { kind: "gameNotFound", persistent: true })
    let log = addNotice(addNotice([], first, 10), notice("a"), 10)
    log = addNotice(log, notice("p2", { kind: "gameNotFound", persistent: true }), 10)
    assert.deepStrictEqual(ids(log), ["p2", "a"])
    log = resolveNotices(log, "gameNotFound", "2026-10-31T13:00:00.000Z")
    assert.strictEqual(log[0]?.resolvedAt, "2026-10-31T13:00:00.000Z")
    // a resolved one is history: the next of its kind doesn't replace it
    log = addNotice(log, notice("p3", { kind: "gameNotFound", persistent: true }), 10)
    assert.deepStrictEqual(ids(log), ["p3", "p2", "a"])
    assert.strictEqual(resolveNotices(log, "other", "x"), log)
  })

  it("marks read, counts unread and clears all but the pinned", () => {
    const log = [notice("a"), notice("b", { persistent: true, kind: "k" }), notice("c", { read: true })]
    assert.strictEqual(unreadCount(log), 2)
    assert.strictEqual(unreadCount(markRead(log, new Set(["a"]))), 1)
    assert.strictEqual(unreadCount(markRead(log)), 0)
    assert.strictEqual(markRead(markRead(log)).length, 3)
    assert.deepStrictEqual(ids(clearNotices(log)), ["b"])
  })

  it("drops every notification of a muted kind, pinned ones too", () => {
    const log = [
      notice("a", { kind: "gameFound" }),
      notice("p", { kind: "gameNotFound", persistent: true }),
      notice("b")
    ]
    assert.deepStrictEqual(ids(dropNotices(log, new Set(["gameNotFound", "gameFound"]))), ["b"])
    assert.strictEqual(dropNotices(log, new Set(["other"])), log)
  })

  it("puts this session's notifications over the kept ones, without duplicates", () => {
    const kept = [notice("old"), notice("p-old", { kind: "k", persistent: true }), notice("same")]
    const current = [notice("new"), notice("same"), notice("p-new", { kind: "k", persistent: true })]
    assert.deepStrictEqual(ids(mergeNotices(current, kept, 100)), ["new", "same", "p-new", "old"])
    assert.deepStrictEqual(ids(mergeNotices(current, kept, 2)), ["new", "p-new"])
  })

  it("lays the panel out as the pinned ones, then by day", () => {
    const log = [
      notice("a", { at: "2026-10-31T12:00:00.000Z" }),
      notice("p", { kind: "k", persistent: true }),
      notice("b", { at: "2026-10-31T09:00:00.000Z" }),
      notice("c", { at: "2026-10-30T09:00:00.000Z" })
    ]
    const { pinned, days } = panelSections(log, (n) => n.at.slice(0, 10))
    assert.deepStrictEqual(ids(pinned), ["p"])
    assert.deepStrictEqual(days.map((d) => [d.day, ids(d.notices)]), [
      ["2026-10-31", ["a", "b"]],
      ["2026-10-30", ["c"]]
    ])
  })
})
