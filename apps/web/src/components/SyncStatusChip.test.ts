import { assert, describe, it } from "@effect/vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SyncStatusChip } from "./SyncStatusChip"

const chip = (props: Parameters<typeof SyncStatusChip>[0]) => renderToStaticMarkup(createElement(SyncStatusChip, props))

describe("the sync status chip", () => {
  it("is a pill filled with the status's tone", () => {
    const unsaved = chip({ status: "unsaved" })
    assert.include(unsaved, "rounded-full")
    assert.include(unsaved, "bg-status-warn")
    assert.include(unsaved, "text-status-warn-foreground")
    assert.notInclude(unsaved, "rounded-control")
  })

  it("keeps Not exported, the resting state, neutral", () => {
    assert.include(chip({ status: "notExported" }), "bg-status-neutral")
  })

  it("is a span on a row, with no icon, and a button when told to be", () => {
    const row = chip({ status: "inSync", icon: false })
    assert.match(row, /^<span/)
    assert.notInclude(row, "<svg")
    const button = chip({ status: "inSync", render: createElement("button", { type: "button" }) })
    assert.match(button, /^<button/)
    assert.include(button, "<svg")
  })
})
