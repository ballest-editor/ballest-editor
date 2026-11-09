import type { FeedbackKind } from "@ballest/contracts"
import { neon } from "@neondatabase/serverless"
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"
import { HOUR_MS } from "./http"

export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", { cause: Schema.Defect() }) {}

/** One feedback submission, as schema.sql's `feedback` table keeps it. The message itself is only in the issue. */
export interface FeedbackRow {
  readonly issueNumber: number
  readonly issueUrl: string
  readonly kind: FeedbackKind
  readonly discord: string | null
  readonly creator: string | null
  readonly appVersion: string
  readonly platform: string
  readonly osVersion: string
  readonly ipHash: string
  readonly receivedAt: Date
}

/** One usage event, as schema.sql's `usage_events` table keeps it; fields another tag has are null. */
export interface EventRow {
  readonly batchId: string
  readonly installId: string
  readonly appVersion: string
  readonly platform: string
  readonly osVersion: string
  readonly tag: "sessionStart" | "sessionEnd" | "error"
  /** When the app says it happened; null when that isn't a time. */
  readonly at: Date | null
  readonly durationS: number | null
  readonly firstLaunch: boolean | null
  readonly errorSource: string | null
  readonly errorMessage: string | null
  readonly errorStack: string | null
  readonly ipHash: string
  readonly receivedAt: Date
}

const decodeCount = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ n: Schema.Int })]))

/** What a client is limited on, each with its own count. */
export type RateRoute = "feedback" | "events"

/** The collect endpoint's Neon database (`DATABASE_URL`, the writer role in schema.sql). */
export class Store extends Context.Service<Store, {
  /**
   * Takes one of `ipHash`'s `limit` slots on `route` for the hour before `now`; false when they're all taken. The slot
   * is written before it is counted, so requests sent together can't all read a count from before any of them.
   */
  readonly takeSlot: (route: RateRoute, ipHash: string, now: Date, limit: number) => Effect.Effect<boolean, StoreError>
  readonly insertFeedback: (row: FeedbackRow) => Effect.Effect<void, StoreError>
  /** Inserts every row in one statement, so a batch is kept whole or not at all. */
  readonly insertEvents: (rows: ReadonlyArray<EventRow>) => Effect.Effect<void, StoreError>
}>()("ballest/collect/Store") {
  static readonly layer = Layer.effect(
    Store,
    Effect.gen(function*() {
      const sql = neon(Redacted.value(yield* Config.Redacted("DATABASE_URL")))
      const query = (text: string, params: ReadonlyArray<unknown>) =>
        Effect.tryPromise({
          try: (): Promise<unknown> => sql.query(text, [...params]),
          catch: (cause) => new StoreError({ cause })
        })
      return Store.of({
        takeSlot: (route, ipHash, now, limit) =>
          query("insert into rate_slots (route, ip_hash, taken_at) values ($1, $2, $3)", [
            route,
            ipHash,
            now.toISOString()
          ]).pipe(
            Effect.andThen(query(
              "select count(*)::int as n from rate_slots where route = $1 and ip_hash = $2 and taken_at > $3",
              [route, ipHash, new Date(now.getTime() - HOUR_MS).toISOString()]
            )),
            Effect.flatMap(decodeCount),
            Effect.map(([row]) => row.n <= limit),
            Effect.mapError((cause) => cause instanceof StoreError ? cause : new StoreError({ cause }))
          ),
        insertFeedback: (row) =>
          query(
            `insert into feedback (issue_number, issue_url, kind, discord, creator, app_version, platform, os_version,
              ip_hash, received_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              row.issueNumber,
              row.issueUrl,
              row.kind,
              row.discord,
              row.creator,
              row.appVersion,
              row.platform,
              row.osVersion,
              row.ipHash,
              row.receivedAt.toISOString()
            ]
          ).pipe(Effect.asVoid),
        insertEvents: (rows) =>
          query(
            `insert into usage_events (batch_id, install_id, app_version, platform, os_version, tag, at, duration_s,
              first_launch, error_source, error_message, error_stack, ip_hash, received_at)
            select batch_id, install_id, app_version, platform, os_version, tag, at, duration_s,
              first_launch, error_source, error_message, error_stack, ip_hash, received_at
            from jsonb_to_recordset($1::jsonb) as r(batch_id uuid, install_id text, app_version text, platform text,
              os_version text, tag text, at timestamptz, duration_s integer, first_launch boolean, error_source text,
              error_message text, error_stack text, ip_hash text, received_at timestamptz)`,
            [JSON.stringify(rows.map((row) => ({
              batch_id: row.batchId,
              install_id: row.installId,
              app_version: row.appVersion,
              platform: row.platform,
              os_version: row.osVersion,
              tag: row.tag,
              at: row.at?.toISOString() ?? null,
              duration_s: row.durationS,
              first_launch: row.firstLaunch,
              error_source: row.errorSource,
              error_message: row.errorMessage,
              error_stack: row.errorStack,
              ip_hash: row.ipHash,
              received_at: row.receivedAt.toISOString()
            })))]
          ).pipe(Effect.asVoid)
      })
    })
  )
}
