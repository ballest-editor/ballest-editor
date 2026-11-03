import { describe, expect, it } from "vitest"
import { hostVersion, isReady, parseLine, replies, replyTo, sandboxState, tail } from "./hostLog.ts"

const log = `[11:51:17.450] [info] [host] Ballest plugin host 0.33.2 starting
[11:51:17.450] [info] [host] sandbox mode is on for this session: nothing leaves this computer or changes your records
[11:51:18.486] [info] [host] sandbox: status on, complete | internet lookups blocked
[11:51:19.000] [info] [host] footer button 'plugins' placed
[11:51:38.706] [info] [host] test: console t.MaxFPS 30 -> ok
[11:51:41.211] [info] [hello-world] still here
[11:51:58.232] [info] [host] test: pieces: [79949 MP_PlayerStart_C at -3955.0,-1785.0,8615.0]
`

describe("hostLog", () => {
  it("takes a line apart", () => {
    expect(parseLine("[11:51:17.450] [warn] [plugin-manager] loaded")).toEqual({
      time: "11:51:17.450",
      level: "warn",
      source: "plugin-manager",
      text: "loaded"
    })
    expect(parseLine("not a log line")).toBeNull()
  })

  it("keeps only the host's test replies, without the prefix", () => {
    expect(replies(log)).toEqual([
      "console t.MaxFPS 30 -> ok",
      "pieces: [79949 MP_PlayerStart_C at -3955.0,-1785.0,8615.0]"
    ])
    expect(replies("")).toEqual([])
  })

  it("reads the sandbox state and readiness", () => {
    expect(sandboxState(log)).toBe("complete")
    expect(sandboxState("[1] [info] [host] sandbox: status on, INCOMPLETE | x")).toBe("incomplete")
    expect(sandboxState("[1] [info] [host] sandbox mode is on for this session")).toBe("starting")
    expect(sandboxState("[1] [info] [host] starting")).toBe("off")
    expect(isReady(log)).toBe(true)
    expect(isReady("")).toBe(false)
    expect(hostVersion(log)).toBe("0.33.2")
  })

  it("tails", () => {
    expect(tail(log, 2)).toEqual([
      "[11:51:41.211] [info] [hello-world] still here",
      "[11:51:58.232] [info] [host] test: pieces: [79949 MP_PlayerStart_C at -3955.0,-1785.0,8615.0]"
    ])
    expect(tail("", 3)).toEqual([])
  })
})

describe("replyTo", () => {
  it("finds the driver plugin's reply for a nonce and nothing else", () => {
    const text =
      `[12:00:00.000] [info] [ballest-driver] reply 17-1 {"ok":true}\n[12:00:00.001] [info] [host] test: reply 17-2 x\n`
    expect(replyTo(text, "17-1")).toBe(`{"ok":true}`)
    expect(replyTo(text, "17-2")).toBeNull()
    expect(replyTo(text, "17")).toBeNull()
  })
})
