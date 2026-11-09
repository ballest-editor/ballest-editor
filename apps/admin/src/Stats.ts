import { neon } from "@neondatabase/serverless"
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"

const Count = Schema.Int
const Seconds = Schema.NullOr(Schema.Finite)

const ActiveInstalls = Schema.Struct({ day: Schema.String, installs: Count })
const SessionsDay = Schema.Struct({
  day: Schema.String,
  sessions: Count,
  firstLaunches: Count,
  medianS: Seconds,
  p90S: Seconds
})
const SessionLength = Schema.Struct({ sessions: Count, medianS: Seconds, p90S: Seconds })
const VersionDay = Schema.Struct({ day: Schema.String, appVersion: Schema.String, installs: Count })
const Platform = Schema.Struct({ platform: Schema.String, installs: Count })
const ErrorGroup = Schema.Struct({
  source: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  count: Count,
  installs: Count,
  lastSeen: Schema.String,
  latestVersion: Schema.NullOr(Schema.String),
  latestStack: Schema.NullOr(Schema.String)
})
const IssueLink = Schema.Struct({ number: Schema.Int, url: Schema.String, kind: Schema.String })
const FeedbackWeek = Schema.Struct({ week: Schema.String, count: Count, issues: Schema.Array(IssueLink) })
const FeedbackEntry = Schema.Struct({
  issueNumber: Schema.Int,
  issueUrl: Schema.String,
  kind: Schema.String,
  discord: Schema.NullOr(Schema.String),
  creator: Schema.NullOr(Schema.String),
  appVersion: Schema.String,
  platform: Schema.String,
  receivedAt: Schema.String
})

/** Everything the dashboard shows, read from schema.sql's views. */
export const Dashboard = Schema.Struct({
  activeInstalls: Schema.Array(ActiveInstalls),
  sessions: Schema.Array(SessionsDay),
  sessionLength: SessionLength,
  versions: Schema.Array(VersionDay),
  platforms: Schema.Array(Platform),
  errors: Schema.Array(ErrorGroup),
  feedbackWeekly: Schema.Array(FeedbackWeek),
  feedbackLatest: Schema.Array(FeedbackEntry)
})
export type Dashboard = typeof Dashboard.Type

export class StatsError extends Schema.TaggedError<StatsError>()("StatsError", { cause: Schema.Defect() }) {}

/** How many days the per-day charts and tables cover. */
export const DAYS = 30

const DAY = "to_char(day, 'YYYY-MM-DD') as day"
const TIME = (column: string, as: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as "${as}"`
const RECENT = `day > current_date - ${DAYS}`

/** One query per part of the dashboard; each answers rows shaped like that part. */
const QUERIES = {
  activeInstalls: `select ${DAY}, installs from daily_active_installs where ${RECENT} order by day`,
  sessions: `select ${DAY}, sessions, first_launches as "firstLaunches", median_s as "medianS", p90_s as "p90S"
    from sessions_daily where ${RECENT} order by day`,
  sessionLength: `select sessions, median_s as "medianS", p90_s as "p90S" from session_length_30d`,
  versions: `select ${DAY}, app_version as "appVersion", installs from versions_daily
    where day > current_date - 7 order by day, app_version`,
  platforms: `select platform, installs from platform_split_30d order by installs desc`,
  errors: `select source, message, count, installs, ${TIME("last_seen", "lastSeen")},
    latest_version as "latestVersion", latest_stack as "latestStack"
    from error_groups order by last_seen desc limit 50`,
  feedbackWeekly: `select to_char(week, 'YYYY-MM-DD') as week, count, issues from feedback_weekly
    order by week desc limit 12`,
  feedbackLatest: `select issue_number as "issueNumber", issue_url as "issueUrl", kind, discord, creator,
    app_version as "appVersion", platform, ${TIME("received_at", "receivedAt")}
    from feedback_latest order by received_at desc limit 50`
} as const

/** What the queries answer: every part a list of rows, the 30-day session length a list of one. */
const decodeRows = Schema.decodeUnknownEffect(Schema.Struct({
  ...Dashboard.fields,
  sessionLength: Schema.Tuple([SessionLength])
}))

/** The dashboard's numbers, from the Neon database (`DATABASE_URL`, the read-only role in schema.sql). */
export class Stats extends Context.Service<Stats, {
  readonly load: Effect.Effect<Dashboard, StatsError>
}>()("ballest/admin/Stats") {
  static readonly layer = Layer.effect(
    Stats,
    Effect.gen(function*() {
      const sql = neon(Redacted.value(yield* Config.Redacted("DATABASE_URL")))
      const rows = (text: string) =>
        Effect.tryPromise({ try: (): Promise<unknown> => sql.query(text), catch: (cause) => new StatsError({ cause }) })
      const load = Effect.all(
        {
          activeInstalls: rows(QUERIES.activeInstalls),
          sessions: rows(QUERIES.sessions),
          sessionLength: rows(QUERIES.sessionLength),
          versions: rows(QUERIES.versions),
          platforms: rows(QUERIES.platforms),
          errors: rows(QUERIES.errors),
          feedbackWeekly: rows(QUERIES.feedbackWeekly),
          feedbackLatest: rows(QUERIES.feedbackLatest)
        },
        { concurrency: "unbounded" }
      ).pipe(
        Effect.flatMap(decodeRows),
        Effect.map((parts): Dashboard => ({ ...parts, sessionLength: parts.sessionLength[0] })),
        Effect.mapError((cause) => cause instanceof StatsError ? cause : new StatsError({ cause })),
        Effect.withSpan("Stats.load")
      )
      return Stats.of({ load })
    })
  )
}
