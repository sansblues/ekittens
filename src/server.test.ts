import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Left, Outdated, Release, type ToScreen } from './lobby'
import { Clock } from './room'

// A room as Cloudflare runs it, faked just enough: storage, sockets that carry their tag through sleep, and the
// runtime's own pong. The room's timers run on Vitest's clock.

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown,
    ) {}
  },
}))

class Socket {
  heard: ToScreen[] = []
  tag: unknown = null
  closed = false
  closeCode?: number
  serializeAttachment(tag: unknown) {
    this.tag = structuredClone(tag)
  }
  deserializeAttachment() {
    return structuredClone(this.tag)
  }
  send(text: string) {
    if (this.closed) throw new Error('closed')
    this.heard.push(JSON.parse(text) as ToScreen)
  }
  close(code?: number) {
    this.closed = true
    this.closeCode = code
  }
}

let next: Socket
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = new Socket()
      1 = next
    },
  )
  vi.stubGlobal('Response', class {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function open() {
  const { RoomServer } = await import('./server')
  const store = new Map<string, unknown>()
  const sockets: Socket[] = []
  let ready: Promise<void> = Promise.resolve()
  const ctx = {
    acceptWebSocket: (ws: Socket) => sockets.push(ws),
    getWebSockets: () => sockets.filter((ws) => !ws.closed),
    setWebSocketAutoResponse: () => {},
    getWebSocketAutoResponseTimestamp: () => new Date(), // every screen's heartbeat, answered just now
    blockConcurrencyWhile: (fn: () => Promise<void>) => (ready = fn()),
    storage: {
      get: async (k: string) => structuredClone(store.get(k)),
      put: async (k: string | Record<string, unknown>, v?: unknown) =>
        void (typeof k === 'string' ? store.set(k, structuredClone(v)) : Object.entries(k).forEach(([a, b]) => store.set(a, b))),
      delete: async (k: string) => void store.delete(k),
      deleteAll: async () => store.clear(),
      setAlarm: async () => {},
    },
  }
  let room = new RoomServer(ctx as never, {} as never)
  await ready
  await room.create('opener'.padEnd(16, '-'))
  const connect = async () => {
    next = new Socket()
    await room.fetch()
    return next
  }
  const say = (ws: Socket, m: object | string) => room.webSocketMessage(ws as never, typeof m === 'string' ? m : JSON.stringify(m))
  /** No code: a reload or a drop. */
  const hangUp = (ws: Socket, code?: number) => {
    ws.closed = true
    return room.webSocketClose(ws as never, code)
  }
  /** Each one in, seated at the faces in turn. */
  const join = async <const W extends string[]>(...who: W) => {
    const screens: Socket[] = []
    for (const [face, name] of who.entries()) {
      screens.push(await connect())
      await say(screens[face]!, hello(name, face))
    }
    return screens as { [K in keyof W]: Socket }
  }
  const restart = async () => {
    const now = Date.now()
    vi.clearAllTimers()
    vi.setSystemTime(now)
    room = new RoomServer(ctx as never, {} as never)
    await ready
  }
  return { connect, say, hangUp, join, restart }
}

const hello = (who: string, face: number, deal?: number) => ({
  t: 'hello',
  key: who.padEnd(16, '-'),
  name: who,
  face,
  release: Release,
  deal,
})
const last = (ws: Socket, t: ToScreen['t']) => ws.heard.findLast((m) => m.t === t)

describe('room server', () => {
  it('tells a screen that dropped mid-game how it ended, never a reload; and deals everyone the next', async () => {
    const { connect, say, hangUp } = await open()
    const ann = await connect()
    const bea = await connect()
    await say(ann, hello('Ann', 0))
    await say(bea, hello('Bea', 1))
    await say(ann, { t: 'bots', faces: [2] })
    await say(ann, { t: 'play' })
    const first = last(ann, 'table')
    if (first?.t !== 'table') throw new Error('no game dealt')

    // Ann's phone sleeps; Bea leaves the game but stays in the room; the clock takes Ann out, and it ends.
    await hangUp(ann)
    const bead = first.cast.findIndex((s) => s.face === 1)
    await say(bea, { t: 'act', deal: first.deal, action: { t: 'out', player: bead, why: 'left' } })
    await vi.advanceTimersByTimeAsync(10 * Clock.move * 1000)
    expect(last(bea, 'lobby')).toMatchObject({ playing: false })

    // Back, still showing that game: first its end, then the room.
    const back = await connect()
    await say(back, hello('Ann', 0, first.deal))
    expect(back.heard.map((m) => m.t)).toEqual(['table', 'lobby'])
    const end = back.heard[0]!
    expect(end.t === 'table' && end.deal === first.deal && !end.view.players[end.view.me!]!.alive).toBe(true)
    // A reload shows no game: just the room.
    const reload = await connect()
    await say(reload, hello('Ann', 0))
    expect(reload.heard.map((m) => m.t)).toEqual(['lobby'])

    // The next game deals everyone here, whoever was still at the last one's end.
    await say(bea, { t: 'play' })
    const again = last(reload, 'table')
    expect(again?.t === 'table' && again.deal !== first.deal && again.cast.filter((s) => !s.bot).length).toBe(2)
  })

  it('restores the remaining time and expires a deadline that passed during a restart', async () => {
    const { connect, say, restart } = await open()
    const ann = await connect()
    const bea = await connect()
    await say(ann, hello('Ann', 0))
    await say(bea, hello('Bea', 1))
    await say(ann, { t: 'play' })
    const game = last(ann, 'table')
    if (game?.t !== 'table') throw new Error('no game dealt')
    for (const ws of [ann, bea]) await say(ws, { t: 'done', deal: game.deal, seen: 0 })

    await vi.advanceTimersByTimeAsync((Clock.move - 5) * 1000)
    await restart()
    expect(last(ann, 'clock')).toEqual({ t: 'clock', seat: game.view.current, left: 5 })
    expect(last(ann, 'moved')).toBeUndefined()

    vi.setSystemTime(Date.now() + 5001)
    await restart()
    expect(last(ann, 'moved')).toMatchObject({
      events: [{ t: 'out', player: game.view.current, why: 'time' }],
      view: { phase: { t: 'over' } },
    })
  })

  it('rechecks restored sockets without closing a socket still waiting to say hello', async () => {
    const { connect, say, restart } = await open()
    const ann = await connect()
    const bea = await connect()
    const waiting = await connect()
    const watcher = await connect()
    await say(ann, hello('Ann', 0))
    await say(bea, hello('Bea', 1))
    await say(watcher, { t: 'look', release: Release })
    ann.tag = { ...(ann.tag as object), release: 'old' }
    watcher.tag = { ...(watcher.tag as object), release: 'old' }

    await restart()
    expect([ann.closeCode, watcher.closeCode, bea.closed, waiting.closed]).toEqual([Outdated, Outdated, false, false])
    await say(waiting, hello('Cal', 2))
    expect(last(waiting, 'lobby')).toMatchObject({ people: [{ face: 0 }, { face: 1 }, { face: 2, you: true }] })
    // Ann's place is kept for her reload, but not forever.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(faces(waiting)).toEqual([1, 2])
  })

  it('ignores moves and acknowledgements from the previous deal', async () => {
    const { connect, say } = await open()
    const ann = await connect()
    const bea = await connect()
    await say(ann, hello('Ann', 0))
    await say(bea, hello('Bea', 1))
    await say(ann, { t: 'play' })
    const first = last(ann, 'table')
    if (first?.t !== 'table') throw new Error('no game dealt')
    await say(ann, { t: 'act', deal: first.deal, action: { t: 'out', player: first.view.me, why: 'left' } })
    const result = last(ann, 'moved')
    await say(bea, { t: 'play' })
    const second = last(ann, 'table')
    if (second?.t !== 'table' || second.deal === first.deal) throw new Error('no rematch dealt')
    await say(ann, { t: 'done', deal: second.deal, seen: 0 })
    await say(bea, { t: 'done', deal: first.deal, seen: 100 })
    expect(last(ann, 'clock')).toBeUndefined()
    await say(bea, { t: 'done', deal: second.deal, seen: 0 })
    expect(last(ann, 'clock')).toMatchObject({ seat: second.view.current })

    const player = second.view.current
    const ws = second.view.me === player ? ann : bea
    const action = { t: 'draw', player }
    await say(ws, { t: 'act', deal: first.deal, action })
    expect(last(ann, 'moved')).toBe(result)
    await say(ws, { t: 'act', deal: second.deal, action })
    expect(last(ann, 'moved')).toMatchObject({ events: [expect.objectContaining({ t: 'drew', player })] })
  })

  it('keeps the place of one who reloads, and lets go of one gone for good a moment later', async () => {
    const { connect, say, hangUp, join } = await open()
    const [ann, bea, cal] = await join('Ann', 'Bea', 'Cal')
    await hangUp(ann)
    await hangUp(bea)
    await say(await connect(), hello('Ann', 0))
    expect(faces(cal)).toEqual([0, 1, 2])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(faces(cal)).toEqual([0, 2])
  })

  it('lets go at once of one who leaves, out of a game still on', async () => {
    const { say, hangUp, join } = await open()
    const [ann, , cal] = await join('Ann', 'Bea', 'Cal')
    await say(ann, { t: 'play' })
    const game = last(cal, 'table')
    if (game?.t !== 'table') throw new Error('no game dealt')
    await say(cal, { t: 'act', deal: game.deal, action: { t: 'out', player: game.view.me, why: 'left' } })
    await hangUp(cal, Left)
    expect([faces(ann), last(ann, 'lobby')]).toMatchObject([[0, 1], { playing: true }])
  })

  it('lets go unread a screen that says too much, and hears a look once, then a hello', async () => {
    const { connect, say } = await open()
    const loud = await connect()
    await say(loud, ' '.repeat(512) + JSON.stringify(hello('Ann', 0)))
    expect([loud.closeCode, loud.heard]).toEqual([1009, []])
    const dan = await connect()
    for (let i = 0; i < 2; i++) await say(dan, { t: 'look', release: Release })
    await say(dan, hello('Dan', 3))
    expect(dan.heard.map((m) => (m.t === 'lobby' ? m.people.map((p) => p.face) : m.t))).toEqual([[], [3]])
  })
})

const faces = (ws: Socket) => {
  const lobby = last(ws, 'lobby')
  return lobby?.t === 'lobby' ? lobby.people.map((p) => p.face) : []
}
