import { UsageBatch } from "@ballest/contracts"
import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Option, Path, Schema } from "effect"
import { DesktopSettings } from "../settings/DesktopSettings"
import { CollectClient, type CollectFetch } from "./CollectClient"
import { ERRORS_PER_SESSION, UsageStats } from "./UsageStats"

const facts = { appVersion: "0.3.0", platform: "linux", osVersion: "6.18" } as const

const decodeBatch = Schema.decodeUnknownSync(Schema.fromJsonString(UsageBatch))

/** A collect endpoint that keeps every body it was sent, and fails while `failing.now` is set. */
const fakeEndpoint = () => {
  const bodies: Array<UsageBatch> = []
  const failing = { now: false }
  const fetch: CollectFetch = (_url, init) => {
    if (failing.now) return Promise.resolve(new Response("down", { status: 503 }))
    // decoded as the endpoint would: what main sends must be a batch it accepts
    bodies.push(decodeBatch(init.body))
    return Promise.resolve(new Response(null, { status: 204 }))
  }
  return { bodies, failing, fetch }
}

const setup = (endpoint: Option.Option<string> = Option.some("https://collect.test")) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const fake = fakeEndpoint()
    const queuePath = path.join(dir, "usage-queue.json")
    const settings = yield* DesktopSettings.make(path.join(dir, "desktop-settings.json"))
    const usage = yield* UsageStats.make(queuePath, { home: "/home/robin", user: "robin" }).pipe(
      Effect.provideService(DesktopSettings, settings),
      Effect.provideService(CollectClient, CollectClient.make(endpoint, facts, fake.fetch))
    )
    const queueExists = fs.exists(queuePath)
    const writeQueue = (value: unknown) => fs.writeFileString(queuePath, JSON.stringify(value))
    return { fake, usage, settings, queueExists, writeQueue }
  })

/** A session and an error, which collect nothing: no request, and no queue left on disk. */
const expectNothingCollected = (env: Effect.Success<ReturnType<typeof setup>>) =>
  Effect.gen(function*() {
    yield* Effect.scoped(env.usage.run)
    yield* env.usage.recordError("main", "boom", "")
    assert.deepStrictEqual(env.fake.bodies, [])
    assert.isFalse(yield* env.queueExists)
  })

const tags = (bodies: ReturnType<typeof fakeEndpoint>["bodies"]) => bodies.flatMap((b) => b.events.map((e) => e._tag))

describe("UsageStats", () => {
  it.effect("collects nothing in a build without an endpoint", () =>
    Effect.gen(function*() {
      const env = yield* setup(Option.none())
      assert.deepStrictEqual(yield* env.usage.state, { enabled: true, noticeShown: false, collecting: false })
      yield* expectNothingCollected(env)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("makes an install id on the first launch and sends its start and its end", () =>
    Effect.gen(function*() {
      const { fake, usage, settings } = yield* setup()
      yield* Effect.scoped(usage.run.pipe(Effect.andThen(Effect.yieldNow)))
      const installId = (yield* settings.get).usage?.installId
      assert.isString(installId)
      assert.deepStrictEqual(tags(fake.bodies), ["sessionStart", "sessionEnd"])
      assert.isTrue(fake.bodies.every((b) => b.installId === installId))
      assert.deepInclude(fake.bodies[0], { ...facts })
      assert.deepInclude(fake.bodies[0]?.events[0], { _tag: "sessionStart", firstLaunch: true })

      // The next launch keeps the id and isn't a first launch.
      yield* Effect.scoped(usage.run.pipe(Effect.andThen(Effect.yieldNow)))
      assert.strictEqual((yield* settings.get).usage?.installId, installId)
      assert.deepInclude(fake.bodies[2]?.events[0], { _tag: "sessionStart", firstLaunch: false })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("ends a session that never ended (a crash) at its last heartbeat", () =>
    Effect.gen(function*() {
      const { fake, usage, writeQueue } = yield* setup()
      const startedAt = Date.parse("2026-11-01T10:00:00Z")
      yield* writeQueue({ formatVersion: 1, session: { startedAt, lastSeen: startedAt + 90_000 }, events: [] })
      yield* Effect.scoped(usage.run.pipe(Effect.andThen(Effect.yieldNow)))
      assert.deepStrictEqual(fake.bodies[0]?.events[0], {
        _tag: "sessionEnd",
        at: "2026-11-01T10:01:30.000Z",
        durationS: 90
      })
      assert.deepInclude(fake.bodies[0]?.events[1], { _tag: "sessionStart", firstLaunch: true })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("keeps what it couldn't send for the next launch", () =>
    Effect.gen(function*() {
      const { fake, usage } = yield* setup()
      fake.failing.now = true
      yield* Effect.scoped(usage.run.pipe(Effect.andThen(Effect.yieldNow)))
      assert.deepStrictEqual(fake.bodies, [])
      fake.failing.now = false
      yield* Effect.scoped(usage.run.pipe(Effect.andThen(Effect.yieldNow)))
      assert.deepStrictEqual(tags(fake.bodies), ["sessionStart", "sessionEnd", "sessionStart", "sessionEnd"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("scrubs errors and keeps at most ERRORS_PER_SESSION of them", () =>
    Effect.gen(function*() {
      const { fake, usage } = yield* setup()
      yield* Effect.scoped(
        Effect.gen(function*() {
          yield* usage.run
          for (let i = 0; i < ERRORS_PER_SESSION + 5; i++) {
            yield* usage.recordError("renderer", "ENOENT /home/robin/maps/Spiral.balledit", "at f (/home/robin/x.js:1)")
          }
        })
      )
      const errors = fake.bodies.flatMap((b) => b.events).filter((e) => e._tag === "error")
      assert.strictEqual(errors.length, ERRORS_PER_SESSION)
      assert.deepInclude(errors[0], {
        source: "renderer",
        message: "ENOENT ~/maps/<map>",
        stack: "at f (~/x.js:1)"
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("turned off, drops the install id and the queue and sends nothing more", () =>
    Effect.gen(function*() {
      const env = yield* setup()
      const { fake, usage, settings, queueExists } = env
      fake.failing.now = true
      yield* Effect.scoped(usage.run)
      assert.isTrue(yield* queueExists)
      assert.deepStrictEqual(yield* usage.set({ enabled: false }), {
        enabled: false,
        noticeShown: false,
        collecting: true
      })
      assert.isUndefined((yield* settings.get).usage?.installId)
      assert.isFalse(yield* queueExists)
      fake.failing.now = false
      yield* expectNothingCollected(env)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("turned back on mid-session, records nothing until the next launch, under a new id", () =>
    Effect.gen(function*() {
      const env = yield* setup()
      const { fake, usage, settings, queueExists } = env
      const first = yield* Effect.scoped(
        Effect.gen(function*() {
          yield* usage.run
          yield* Effect.yieldNow
          const id = (yield* settings.get).usage?.installId
          yield* usage.set({ enabled: false })
          yield* usage.set({ enabled: true })
          yield* usage.recordError("main", "boom", "")
          assert.isFalse(yield* queueExists)
          return id
        })
      )
      // The session that was turned off sent its start, and nothing after.
      assert.deepStrictEqual(tags(fake.bodies), ["sessionStart"])
      yield* Effect.scoped(usage.run.pipe(Effect.andThen(Effect.yieldNow)))
      const next = (yield* settings.get).usage?.installId
      assert.isString(next)
      assert.notStrictEqual(next, first)
      assert.deepStrictEqual(tags(fake.bodies), ["sessionStart", "sessionStart", "sessionEnd"])
      assert.deepInclude(fake.bodies[1]?.events[0], { firstLaunch: true })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
