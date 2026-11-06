import { assert, describe, it } from "@effect/vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CHIP_STATUS_LABELS, type ChipStatus, WIDEST_CHIP_LABEL } from "../domain/linkState"
import { StatusBarChip, SyncStatusChip } from "./SyncStatusChip"

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

  it("says Saved in the ok tone, with a plain check", () => {
    const saved = chip({ status: "saved" })
    assert.include(saved, "Saved")
    assert.include(saved, "bg-status-ok")
    assert.include(saved, "tabler-icon-check")
  })

  it("has no transition, so a colour can't trail the label it belongs to", () => {
    const saved = chip({ status: "saved" })
    assert.include(saved, "transition-none")
    assert.notInclude(saved, "transition-all")
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

describe("the status bar's chip", () => {
  const barChip = (props: Parameters<typeof StatusBarChip>[0]) =>
    renderToStaticMarkup(createElement(StatusBarChip, props))
  const statuses: ReadonlyArray<ChipStatus> = [
    "saved",
    "unsaved",
    "notExported",
    "inSync",
    "changedSinceExport",
    "publishedDraft"
  ]

  it("holds the room of the widest label in every state, so it keeps one width", () => {
    for (const status of statuses) {
      const markup = barChip({ status, write: null })
      assert.include(markup, `aria-hidden="true">${WIDEST_CHIP_LABEL}</span>`)
      assert.include(markup, `>${CHIP_STATUS_LABELS[status]}</span>`)
    }
  })

  it("has no bar at rest", () => {
    assert.notInclude(barChip({ status: "inSync", write: null }), "progressbar")
  })

  it("says the stage with the bar at its place, and wears no status while it works", () => {
    const write = { intent: "export", fileName: "a.balledit", stage: "verify" } as const
    const markup = barChip({ status: "unsaved", write })
    assert.include(markup, "Verifying…")
    assert.include(markup, "role=\"progressbar\"")
    assert.include(markup, "aria-valuenow=\"100\"")
    assert.include(markup, "bg-status-neutral")
    assert.notInclude(markup, "bg-status-warn")
    assert.include(markup, `aria-hidden="true">${WIDEST_CHIP_LABEL}</span>`)
  })
})
