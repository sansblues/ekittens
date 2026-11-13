import { Left, Outdated, Release, type ToRoom, type ToScreen } from '../lobby'
import { acknowledgeDeal, after, forgetPlaying, forgetRoom, listen, now, reload, rememberRoom, rememberedDeal, save } from './browser'
import { Game } from './game'

// Your screen's line to a room with friends. It listens from a friend's link on, says who you are once you
// join, keeps the line alive and brings it back when it drops (a phone asleep, a network gone, a new release),
// and hands on what it hears.

/** The lobby, as the room tells it. */
export type Heard = Extract<ToScreen, { t: 'lobby' }>

export interface Line {
  /** connecting: not heard from yet. lost: dropped, coming back. gone: there's no such room. taken: the code
   *  this screen picked for a new room is someone else's. */
  status: 'connecting' | 'open' | 'lost' | 'gone' | 'taken'
  lobby: Heard | null
  game: Game | null
}

/** Who you are to a room: your key, and the name and face you'd like. */
type Hello = { key: string; name: string; face: number }

/** In seconds: a heartbeat this often. A ping still unanswered at the next has dropped: a phone's line can,
 *  unannounced, and its close may not come until the network does. So has a socket still dialing. */
const Pulse = 10
/** In seconds: back to the screen, how long a ping has to be answered. */
const Answer = 4

export class Online {
  line: Line = { status: 'connecting', lobby: null, game: null }
  private ws: WebSocket | null = null
  private listeners = new Set<() => void>()
  /** What stops each running timer, and listening for the screen's return. */
  private stop = { retry: () => {}, pulse: () => {}, back: () => {} }
  private tries = 0
  private heardAt = now()
  private pingedAt = 0
  private dialedAt = 0
  private closed = false
  private creating: AbortController | null = null
  /** Your last deal, until its end is acknowledged. Kept in memory when storage is unavailable. */
  private pending: number | undefined
  /** Asked for while a room is only just opening: the latest of each, said as soon as it opens. After a drop
   *  they're not kept: by the time the line is back, the room may have moved on. While this screen is still
   *  opening the room, they're kept: nobody else is in it yet. */
  private asked: { bots?: ToRoom; play?: ToRoom } = {}

  /** `hello`: null while only looking, from a friend's link, until you join. `opening`: this screen opens the
   *  room first, trying until it's open, however long the network is away. */
  constructor(
    readonly code: string,
    private hello: Hello | null,
    private opening = false,
  ) {
    this.pending = rememberedDeal(code)
    this.connect()
    this.stop.back = listen(document, 'visibilitychange', () => document.visibilityState === 'visible' && this.wake())
    this.pulse()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** You join: said at once, or as soon as the line is open, and again after each drop. The lobby is heard
   *  anew, with you in it; a game you watched from the link is put away. */
  join(hello: Hello) {
    this.hello = hello
    this.line.game?.dispose()
    this.set({ lobby: null, game: null })
    this.send(this.helloFor())
  }

  bots(faces: number[]) {
    this.ask({ t: 'bots', faces })
  }

  play() {
    this.ask({ t: 'play' })
  }

  acknowledge(deal: number) {
    if (this.pending === deal) this.pending = undefined
    acknowledgeDeal(this.code, deal)
  }

  /** You leave the room: out of its game if you're in one, and it's no longer your way back. */
  leave() {
    this.line.game?.quit()
    if (this.hello) forgetRoom(this.code)
    this.close(Left)
  }

  /** `code`: `Left` tells the room you left for good; a plain close may be a reload. */
  close(code?: number) {
    this.closed = true
    this.creating?.abort()
    Object.values(this.stop).forEach((stop) => stop())
    const ws = this.ws
    this.ws = null
    ws?.close(code)
    this.line.game?.dispose()
    this.listeners.clear()
  }

  private connect() {
    this.stop.retry()
    this.ws?.close()
    if (this.opening) return void this.open()
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rooms/${this.code}`)
    this.ws = ws
    this.dialedAt = now()
    // Only the newest socket speaks: an old one closing late must not call the line lost again.
    ws.onopen = () => {
      if (ws !== this.ws) return
      // The heartbeat counts from now, not from before a sleep.
      this.heardAt = now()
      this.pingedAt = 0
      this.send(this.hello ? this.helloFor() : { t: 'look', release: Release })
      const { bots, play } = this.asked
      this.asked = {}
      for (const m of [bots, play]) if (m) this.send(m)
    }
    ws.onmessage = (e) => {
      if (ws !== this.ws) return
      this.heardAt = now()
      if (e.data !== 'pong') this.hear(JSON.parse(e.data as string) as ToScreen)
    }
    ws.onclose = (e) => {
      if (ws !== this.ws) return
      // A new release is out: this page is too old for the room. Reloaded, it comes straight back.
      if (e.code !== Outdated || !reload()) this.lost()
    }
  }

  /** Opens the room, then joins it; a network away is a line dropped, tried again as one is. */
  private async open() {
    if (this.creating) return
    const request = new AbortController()
    this.creating = request
    const stop = after(Pulse, () => request.abort())
    const r = await fetch(`/api/rooms/${this.code}`, { method: 'POST', body: this.hello!.key, signal: request.signal }).catch(() => null)
    stop()
    this.creating = null
    if (this.closed) return
    if (r?.status === 409) return this.set({ status: 'taken' })
    if (!r?.ok) return this.lost()
    this.opening = false
    this.connect()
  }

  /** The line dropped: it's said, and it comes back soon, then less often: 0.5, 1, 2, 4, then every 5 s. */
  private lost() {
    if (this.line.status === 'gone') return
    this.ws = null
    if (!this.opening) this.asked = {}
    this.set({ status: 'lost' })
    this.stop.retry = after(Math.min(5, 0.5 * 2 ** this.tries++), () => this.connect())
  }

  private pulse() {
    const ws = this.ws
    const open = ws?.readyState === WebSocket.OPEN
    const dialing = ws?.readyState === WebSocket.CONNECTING && now() - this.dialedAt >= Pulse
    if ((open && this.pingedAt > this.heardAt) || dialing) {
      ws!.close()
      this.lost()
    } else if (open) this.ping()
    this.stop.pulse = after(Pulse, () => this.pulse())
  }

  /** Back to the screen: a line that dropped while away comes back at once; one that seems open is asked at once,
   *  since a phone asleep may have lost it unannounced. */
  private wake() {
    if (this.line.status === 'lost') return this.connect()
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ping()
    this.stop.pulse()
    this.stop.pulse = after(Answer, () => this.pulse())
  }

  private ping() {
    this.ws!.send('ping')
    this.pingedAt = now()
  }

  private hear(m: ToScreen) {
    const { line } = this
    switch (m.t) {
      case 'gone':
        forgetRoom(this.code)
        return this.set({ status: 'gone' })
      case 'lobby': {
        // After hello, a lobby without its game means the room no longer has the requested deal.
        const game = line.status !== 'open' && !m.playing ? null : line.game
        if (game !== line.game) line.game?.dispose()
        // Seated here, in its lobby or its game, it's your way back after a reload.
        if (m.people.some((p) => p.you)) {
          rememberRoom(this.code)
          if (!m.playing && !game && this.pending !== undefined) this.acknowledge(this.pending)
        }
        if (!m.playing) forgetPlaying(this.code)
        return this.set({ status: 'open', lobby: m, game })
      }
      case 'table': {
        // The game on, told again after a drop, is caught up with; any other is a new one.
        let game = line.game
        if (game?.deal === m.deal) game.reset(m)
        else {
          game?.dispose()
          game = new Game(
            {
              join: () => () => {},
              act: (action) => this.send({ t: 'act', deal: m.deal, action }),
              done: (seen) => this.send({ t: 'done', deal: m.deal, seen }),
            },
            m,
          )
          if (m.view.me !== null) {
            this.pending = m.deal
            rememberRoom(this.code, m.deal)
          } else if (this.pending !== undefined) {
            // Dealt without you (you dropped as your game ended): the room no longer keeps that game, so stop asking for it.
            this.acknowledge(this.pending)
          }
        }
        // A game told after it ended (back after a drop) is no way back.
        if (m.view.me !== null && m.view.phase.t !== 'over') save('playing', this.code)
        return this.set({ status: 'open', game })
      }
      case 'moved':
      case 'window':
      case 'clock':
        return line.game?.hear(m)
    }
  }

  private set(patch: Partial<Line>) {
    if (patch.status === 'open') this.tries = 0
    this.line = { ...this.line, ...patch }
    this.line.game?.setOffline(this.line.status !== 'open')
    this.listeners.forEach((fn) => fn())
  }

  private ask(m: Extract<ToRoom, { t: 'bots' | 'play' }>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.send(m)
    else if (this.line.status === 'connecting' || this.opening) this.asked[m.t] = m
  }

  /** Who you are, and the game this screen still shows: if it ended while the line was down, the room tells how. */
  private helloFor(): ToRoom {
    return { t: 'hello', ...this.hello!, release: Release, ...(this.pending !== undefined && { deal: this.pending }) }
  }

  private send(m: ToRoom) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }
}
