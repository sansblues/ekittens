import { DurableObject } from 'cloudflare:workers'
import { Characters, Left, Outdated, Release, arrive, asCode, canPlay, leave, parse, pickBots, type Lobby, type ToScreen } from './lobby'
import { Room, Version, type Deadline, type Saved, type Screen } from './room'

// The rooms friends play in, one Durable Object each, named by the code in its link. A room sleeps
// when nothing is due (its sockets stay open) and wakes from what it keeps.

interface Env {
  ROOMS: DurableObjectNamespace<RoomServer>
}

/** A game, and the key of the person at each seat (null for a bot's). */
interface Kept {
  saved: Saved
  keys: (string | null)[]
  deadline?: Deadline
}

/** A screen's own, kept through the room's sleep: when it connected, and who it is once it has a seat. */
interface Tag {
  at: number
  key: string | null
  release?: string
  /** At the link without a seat (not joined, or turned away, the table full): it hears the lobby, and watches
   *  any game on. */
  looking?: boolean
}

/** An empty room is forgotten after a day. A screen silent this long has gone without a word (a phone off the
 *  network): it's let go. A hidden tab's heartbeat may slow to once a minute. One whose line closed without
 *  leaving (a reload, a drop) keeps their place this long, to come back to. */
const Forget = 24 * 60 * 60
const Silent = 90
const Grace = 5

/** In characters. A screen's longest message is its hello, under 400 even with twelve of the longest emoji for a
 *  name: a screen sends its name clipped, and the room cleans it again. */
const MessageLength = 512

/** In seconds, as everywhere; the runtime's own clock, alarms and timers count in ms. */
const now = () => Date.now() / 1000

/** Runs `fn` in `s` seconds; returns what cancels it. */
const after = (s: number, fn: () => void) => {
  const t = setTimeout(fn, Math.ceil(s * 1000))
  return () => clearTimeout(t)
}

export class RoomServer extends DurableObject<Env> {
  /** Null: no such room. */
  private lobby: Lobby | null = null
  private game: Room | null = null
  private keys: (string | null)[] = []
  /** Whether a game was on when the screens last heard: its end makes the room a lobby again. */
  private on = false
  private leaves = new WeakMap<WebSocket, () => void>()
  /** Sockets this room closed: gone for it, though the runtime may list them a moment longer. */
  private closed = new WeakSet<WebSocket>()
  /** Those within their `Grace`, by key: each one's cancel. */
  private parting = new Map<string, () => void>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // A screen's heartbeat, answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    void ctx.blockConcurrencyWhile(async () => {
      const lobby = await ctx.storage.get<Lobby>('lobby')
      if (!lobby) return
      // Hibernating sockets can survive a deploy. Check them before attaching them to the new code.
      for (const ws of this.sockets()) {
        const tag = this.tag(ws)
        if ((tag.key || tag.looking) && tag.release !== Release) this.disconnect(ws, Outdated)
      }
      this.lobby = lobby
      const kept = await ctx.storage.get<Kept>('game')
      // A game kept in an older shape can't be read back: the room is a lobby again.
      if (!kept || kept.saved.v !== Version) await ctx.storage.delete('game')
      else {
        this.keys = kept.keys
        this.game = new Room(kept.saved, this.host(), kept.deadline)
        this.on = this.playing()
      }
      // Whoever has no line here may be on their way back (a deploy reloads every screen): each has their grace.
      lobby.people.forEach((p) => this.part(p.key))
      // The remaining screens already know the game. Resume its pending decision.
      const game = this.game
      if (!game) return
      for (const ws of this.sockets()) {
        const tag = this.tag(ws)
        if (tag.key || tag.looking) this.leaves.set(ws, game.attach(this.screen(ws, tag.key)))
      }
      game.resume()
    })
  }

  /** Opens a room for the screen of `key`, its seats empty; false if the code is someone else's. Asked again by
   *  the same screen (its answer lost on the way), it's open. */
  async create(key: string): Promise<boolean> {
    if (this.lobby) return (await this.ctx.storage.get<string>('opener')) === key
    this.lobby = { people: [], bots: [] }
    await this.ctx.storage.put({ lobby: this.lobby, opener: key })
    await this.forgetLater()
    return true
  }

  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ at: now(), key: null } satisfies Tag)
    if (!this.lobby) {
      this.send(server, { t: 'gone' })
      server.close(4004, 'gone')
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, text: string | ArrayBuffer) {
    if (this.closed.has(ws)) return
    // Longer is no screen of ours, and parsing it could run the room out of memory: it's let go unread.
    if (typeof text !== 'string' || text.length > MessageLength) return this.drop(ws, 1009)
    await this.prune(ws)
    const m = parse(text)
    const tag = this.tag(ws)
    const { key } = tag
    if (!m || !this.lobby || (m.t !== 'hello' && m.t !== 'look' && !key)) return
    if (m.t === 'hello' || m.t === 'look') {
      // Said once, first, though one looking may still join. A screen of another release reloads, and comes back
      // as a new one.
      if (key || (m.t === 'look' && tag.looking)) return
      if (m.release !== Release) return this.drop(ws, Outdated)
    }
    const seat = key ? this.keys.indexOf(key) : -1
    switch (m.t) {
      // A friend's link, before joining: it hears who's here, and each change, live; and watches any game on.
      case 'look':
        return this.look(ws, { ...tag, release: m.release })
      case 'hello': {
        // One already here (a reload, a new tab) keeps their seat.
        const lobby = arrive(this.lobby, m.key, m.name, m.face)
        // Every seat a person's: turned away, it goes on looking, and may join once one frees.
        if (!lobby.people.some((p) => p.key === m.key)) return this.look(ws, { ...tag, release: m.release })
        ws.serializeAttachment({ ...tag, key: m.key, looking: false, release: m.release } satisfies Tag)
        // The game first, so a reload mid-game never shows the lobby for a moment. A screen still showing a game
        // that has since ended (it dropped before the end) is told the end.
        this.watch(ws, m.key, m.deal)
        await this.setLobby(lobby)
        return
      }
      // The table is set by those at it.
      case 'bots':
        return this.seated(key) ? this.setLobby(pickBots(this.lobby, m.faces)) : undefined
      case 'play':
        return this.seated(key) ? this.play() : undefined
      case 'act':
        if (seat >= 0 && this.game?.saved.deal === m.deal) this.game.act(seat, m.action)
        return
      case 'done':
        if (seat >= 0 && this.game?.saved.deal === m.deal) this.game.done(seat, m.seen)
        return
    }
  }

  async webSocketClose(ws: WebSocket, code?: number) {
    // Once: a socket this room dropped may still close on its own later.
    const stop = this.leaves.get(ws)
    this.leaves.delete(ws)
    stop?.()
    const open = this.sockets().filter((s) => s !== ws)
    const { key } = this.tag(ws)
    // Leaving, they're gone now; any other close may be a reload or a drop, back in a moment.
    if (key && code === Left) {
      this.parting.get(key)?.()
      this.parting.delete(key)
      await this.tidy(ws)
    } else if (key) this.part(key)
    if (open.length === 0 && this.lobby) await this.forgetLater()
  }

  /** A socket that failed is let go as one that closed. */
  async webSocketError(ws: WebSocket) {
    if (!this.closed.has(ws)) await this.drop(ws, 1011)
  }

  async alarm() {
    await this.prune()
    if (this.sockets().length > 0) return this.forgetLater()
    this.game?.dispose()
    this.game = null
    this.lobby = null
    await this.ctx.storage.deleteAll()
  }

  /** The room is forgotten a day from now, unless someone is here then. */
  private forgetLater() {
    return this.ctx.storage.setAlarm((now() + Forget) * 1000)
  }

  /** Lets go of every screen silent past `Silent` but `talking`: a ping answered, or its connecting, is the
   *  last word heard. */
  private async prune(talking?: WebSocket) {
    for (const ws of this.sockets()) {
      if (ws === talking) continue
      const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)
      if (now() - (ping ? ping.getTime() / 1000 : this.tag(ws).at) > Silent) await this.drop(ws, 4000)
    }
  }

  /** Closes a socket from this end, and the room lets it go as if it had closed itself. */
  private async drop(ws: WebSocket, code: number) {
    this.disconnect(ws, code)
    await this.webSocketClose(ws)
  }

  private disconnect(ws: WebSocket, code: number) {
    this.closed.add(ws)
    try {
      ws.close(code)
    } catch {
      // Already closing.
    }
  }

  /** A screen at the link without a seat: it hears who's here, and watches the game on, if one is. */
  private look(ws: WebSocket, tag: Tag) {
    ws.serializeAttachment({ ...tag, looking: true } satisfies Tag)
    this.send(ws, this.told(null))
    this.watch(ws, null)
  }

  /** A screen sees the game on, if one is, from the seat of `key` or (null) from the link; and the last one too, if
   *  that is the `deal` it still shows. */
  private watch(ws: WebSocket, key: string | null, deal?: number) {
    this.leaves.get(ws)?.()
    this.leaves.delete(ws)
    if (this.game && (this.playing() || deal === this.game.saved.deal)) this.leaves.set(ws, this.game.join(this.screen(ws, key)))
  }

  /** The lobby without those gone: no tab of theirs here (but `closing`), none within its `Grace`, and no seat
   *  still in a game that's on, kept for them to come back to. With nobody gone, the same lobby. */
  private present(lobby: Lobby, closing?: WebSocket): Lobby {
    const here = new Set([...this.sockets().flatMap((ws) => (ws === closing ? [] : [this.tag(ws).key])), ...this.parting.keys()])
    const players = this.playing() ? this.game!.state.players : []
    const kept = this.keys.filter((_, seat) => players[seat]?.alive)
    return lobby.people.filter((p) => !here.has(p.key) && !kept.includes(p.key)).reduce((l, p) => leave(l, p.key), lobby)
  }

  /** Keeps the place of `key`, whose line closed, for `Grace`: then they're let go, unless back. */
  private part(key: string) {
    this.parting.get(key)?.()
    this.parting.set(
      key,
      after(Grace, () => {
        this.parting.delete(key)
        void this.tidy()
      }),
    )
  }

  /** Lets go of those gone, if anyone is. */
  private async tidy(closing?: WebSocket) {
    const lobby = this.lobby && this.present(this.lobby, closing)
    if (lobby && lobby !== this.lobby) await this.setLobby(lobby)
  }

  private seated = (key: string | null) => !!key && !!this.lobby?.people.some((p) => p.key === key)

  /** Everyone here and at least two at the table: a new game, seats dealt anew. */
  private async play() {
    const lobby = this.lobby!
    if (this.playing() || !canPlay(lobby)) return
    const people = new Map(lobby.people.map((p) => [p.face, p]))
    // Dealt to everyone here, those still at the last game's end too: the new game takes its place.
    const cast = [
      ...lobby.people.map((p) => ({ face: p.face, name: p.name, bot: false })),
      ...lobby.bots.map((face) => ({ face, name: Characters[face]!.name, bot: true })),
    ]
    this.game?.dispose()
    this.keys = []
    const game = Room.start(cast, this.host())
    this.game = game
    this.keys = game.cast.map((s) => (s.bot ? null : people.get(s.face)!.key))
    this.on = true
    await this.keep(game.saved)
    // Those dealt in play, and everyone at the link watches.
    for (const ws of this.sockets()) {
      const tag = this.tag(ws)
      if (tag.key || tag.looking) this.leaves.set(ws, game.join(this.screen(ws, tag.key)))
    }
    this.tellLobby()
  }

  /** A game is on while it isn't over and someone is still in it. */
  private playing(): boolean {
    const game = this.game
    if (!game || game.state.phase.t === 'over') return false
    return game.state.players.some((p, seat) => p.alive && this.keys[seat] !== null)
  }

  private host() {
    return {
      after,
      now,
      random: Math.random,
      save: (saved: Saved, deadline?: Deadline) => {
        void this.keep(saved, deadline)
        // The game ends for the room: it's a lobby again, told once the screens have heard the last move.
        if (this.on && !this.playing()) {
          this.on = false
          // Seats kept for those gone mid-game come free.
          queueMicrotask(() => void this.setLobby(this.present(this.lobby!)))
        }
      },
    }
  }

  /** Kept with the seats' keys; while a new game deals, those are still to come (play keeps it again). */
  private keep(saved: Saved, deadline?: Deadline) {
    return this.ctx.storage.put('game', { saved, keys: this.keys, ...(deadline && { deadline }) } satisfies Kept)
  }

  /** A screen at its seat, or (no seat) watching. */
  private screen(ws: WebSocket, key: string | null): Screen {
    const seat = key ? this.keys.indexOf(key) : -1
    return { seat: seat >= 0 ? seat : null, tell: (told) => this.send(ws, told) }
  }

  private async setLobby(lobby: Lobby) {
    this.lobby = lobby
    await this.ctx.storage.put('lobby', lobby)
    this.tellLobby()
  }

  /** Each screen that has spoken hears who's here, itself marked: one only just connected hears it once it
   *  has said who it is, never a lobby without itself in it. */
  private tellLobby() {
    if (!this.lobby) return
    for (const ws of this.sockets()) {
      const { key, looking } = this.tag(ws)
      if (key || looking) this.send(ws, this.told(key))
    }
  }

  /** The lobby as the screen of `key` hears it: never anyone's key. */
  private told(key: string | null): ToScreen {
    const { people, bots } = this.lobby!
    const told = people.map((p) => ({ name: p.name, face: p.face, you: p.key === key }))
    return { t: 'lobby', people: told, bots, playing: this.playing() }
  }

  private sockets = () => this.ctx.getWebSockets().filter((ws) => !this.closed.has(ws))

  private tag = (ws: WebSocket): Tag => (ws.deserializeAttachment() as Tag | null) ?? { at: 0, key: null }

  private send(ws: WebSocket, message: ToScreen) {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // Already closing: its close will tidy up.
    }
  }
}

export default {
  async fetch(request, env) {
    const code = asCode(/^\/api\/rooms\/(\w+)$/.exec(new URL(request.url).pathname)?.[1] ?? '')
    if (!code) return new Response('not found', { status: 404 })
    const room = env.ROOMS.getByName(code)
    // A screen opens a room under a code of its own picking, saying whose screen it is.
    if (request.method === 'POST') {
      // A body that says it's longer than a key is never read.
      if (Number(request.headers.get('Content-Length')) > 64) return new Response('no key', { status: 400 })
      const key = await request.text()
      if (key.length < 16 || key.length > 64) return new Response('no key', { status: 400 })
      return (await room.create(key)) ? new Response(null, { status: 201 }) : new Response('taken', { status: 409 })
    }
    return request.headers.get('Upgrade') === 'websocket' ? room.fetch(request) : new Response('not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
