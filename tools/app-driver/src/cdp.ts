/** A small Chrome DevTools Protocol client over Node's WebSocket: the repo has no Playwright or Puppeteer, on purpose. */

type Params = Readonly<Record<string, unknown>>
type Listener<T = never> = (params: T, sessionId: string | undefined) => void

interface Reply {
  readonly id?: number
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly message: string }
  readonly sessionId?: string
}

const CALL_TIMEOUT_MS = 120_000

/** JSON this tool or the browser wrote, in a shape it knows. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters, typescript/no-unsafe-type-assertion -- only ever files and messages of our own making
export const parseJson = <T>(text: string): T => JSON.parse(text) as T

export class Cdp {
  /** Whether the browser has gone: nothing sent now can answer. */
  closed = false
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly listeners = new Map<string, Set<Listener<unknown>>>()

  private readonly socket: WebSocket

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener("message", (event) => this.receive(String(event.data)))
    socket.addEventListener("close", () => {
      this.closed = true
      for (const { reject } of this.pending.values()) reject(new Error("the browser closed its connection"))
      this.pending.clear()
    })
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.addEventListener("open", () => resolve(new Cdp(socket)), { once: true })
      socket.addEventListener("error", () => reject(new Error(`can't reach the browser at ${url}`)), { once: true })
    })
  }

  private receive(data: string) {
    const message = parseJson<Reply>(data)
    if (message.id !== undefined) {
      const call = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error === undefined) call?.resolve(message.result)
      else call?.reject(new Error(message.error.message))
    } else if (message.method !== undefined) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId)
    }
  }

  send<T = void>(method: string, params: Params = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error("the browser is gone"))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} got no reply`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the caller names the protocol's reply type
          resolve(value as T)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }))
    })
  }

  on<T>(method: string, listener: Listener<T>): () => void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the caller names the protocol's event type
    const stored = listener as unknown as Listener<unknown>
    const set = this.listeners.get(method) ?? new Set()
    this.listeners.set(method, set.add(stored))
    return () => {
      set.delete(stored)
    }
  }

  close() {
    this.socket.close()
  }
}

export interface PageTarget {
  readonly sessionId: string
  readonly close: () => Promise<void>
}

/** A page in a browser context of its own: empty storage, and nothing a dirty map's `beforeunload` can hang. */
export const openContextPage = async (browser: Cdp): Promise<PageTarget> => {
  const { browserContextId } = await browser.send<{ browserContextId: string }>("Target.createBrowserContext")
  const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", {
    url: "about:blank",
    browserContextId
  })
  const { sessionId } = await browser.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })
  return { sessionId, close: () => browser.send("Target.disposeBrowserContext", { browserContextId }) }
}
