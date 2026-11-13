import { act, react, remember, type Memory } from './bot'
import {
  apply,
  check,
  eventFor,
  lastIn,
  setup,
  shuffle,
  view,
  waitingOn,
  type Action,
  type Event,
  type PlayerId,
  type Rng,
  type State,
  type View,
} from './engine'

// The authority over one game: it takes the moves, plays the bots and keeps time. It runs in your tab
// for a game against bots, and on the server for a game with friends. Each screen hears only its seat's
// view of the table, and what its seat may know of each move.

/** In seconds. */
export const Clock = {
  /** How long anyone may Nope a play. */
  window: 5,
  /** The longest the table waits for a screen to finish showing a move. */
  pace: 6,
  /** How long a person has for each move while someone else waits on them: then they're out. */
  move: 30,
} as const

/** Each seat's face, as an index into the characters, the name it goes by (a bot's is its face's), and whether a
 *  bot plays it. */
interface Seat {
  face: number
  name: string
  bot: boolean
}

export type Cast = Seat[]

/** What a screen hears. */
export type Told =
  /** Where things stand, and everything this seat saw happen: as it joins. `deal` tells one game from the next. */
  | { t: 'table'; deal: number; cast: Cast; view: View; events: Event[] }
  | { t: 'moved'; view: View; events: Event[] }
  /** A Nope window's clock started, with `left` seconds to go. */
  | { t: 'window'; left: number }
  /** `seat` has `left` seconds for their move; the next move stops the clock. */
  | { t: 'clock'; seat: PlayerId; left: number }

/** A screen at the table, at a seat or (null) watching. */
export interface Screen {
  seat: PlayerId | null
  tell: (told: Told) => void
}

/** The deadline for the current decision, in the host's clock. */
export type Deadline = { t: 'window'; id: number; ends: number } | { t: 'clock'; seat: PlayerId; ends: number }

/** What the room needs from wherever it runs. */
export interface Host {
  /** Runs `fn` in `s` seconds; returns what cancels it. */
  after: (s: number, fn: () => void) => () => void
  /** In seconds, from any fixed point. */
  now: () => number
  random: () => number
  save: (saved: Saved, deadline?: Deadline) => void
}

/** A save of another version can't be picked up again. Bump it when `Saved` changes. */
export const Version = 7

export interface Saved {
  v: typeof Version
  /** This game's own number, drawn as it's dealt. */
  deal: number
  state: State
  cast: Cast
  memory: Memory[]
  /** Everything that happened, as it happened: each screen hears its own share as it joins. */
  events: Event[]
}

export class Room {
  private screens = new Set<Screen>()
  /** The seats whose screens still show the last move. */
  private showing = new Set<PlayerId>()
  /** Each running timer's cancel, by key. */
  private timers = new Map<string, () => void>()
  constructor(
    readonly saved: Saved,
    private host: Host,
    private deadline?: Deadline,
  ) {}

  /** Each game deals the seats anew, people and bots alike; the first seat starts. */
  static start(players: Cast, host: Host): Room {
    const rng = { rng: [0, 0, 0, 0].map(() => (host.random() * 2 ** 32) >>> 0) as Rng }
    const cast = shuffle(rng, [...players])
    const state = setup(cast.length, rng.rng)
    const deal = (host.random() * 2 ** 32) >>> 0
    const room = new Room({ v: Version, deal, state, cast, memory: cast.map(() => []), events: [] }, host)
    host.save(room.saved)
    return room
  }

  get state(): State {
    return this.saved.state
  }

  get cast(): Cast {
    return this.saved.cast
  }

  /** Where things stand for `seat`, and everything it saw happen. */
  table(seat: PlayerId | null): Extract<Told, { t: 'table' }> {
    const { deal, cast, state, events } = this.saved
    return { t: 'table', deal, cast, view: view(state, seat), events: events.map((e) => eventFor(e, seat)) }
  }

  /** A screen joins; it's told where things stand, and the table waits for it to catch up. Returns its leave. */
  join(screen: Screen): () => void {
    this.expireDue()
    const leave = this.attach(screen)
    const person = this.isPerson(screen.seat) ? screen.seat : null
    if (person !== null) this.await([person])
    screen.tell(this.table(screen.seat))
    // Joining never restarts a clock: it hears how long is left.
    if (this.deadline) this.tellDeadline(screen, this.deadline)
    // Someone come to watch waits on whoever's move it is: their clock may start now.
    else if (person === null && this.showing.size === 0) this.next()
    return leave
  }

  /** A screen that already knows where things stand, as after the room woke from sleep. Returns its leave. */
  attach(screen: Screen): () => void {
    this.screens.add(screen)
    return () => {
      this.screens.delete(screen)
      if (screen.seat !== null) this.done(screen.seat)
    }
  }

  /** The server restores the deadline before any new move can arrive. */
  resume() {
    if (this.deadline) this.runDeadline(this.deadline)
    else this.next()
  }

  /** A move from a screen, for its own seat only. A Nope counts once its window's clock runs. */
  act(seat: PlayerId, action: Action) {
    if (action.t === 'expire' || action.player !== seat || !this.isPerson(seat)) return
    if (this.expireDue()) return
    if (action.t === 'nope' && (this.deadline?.t !== 'window' || action.id !== this.deadline.id)) return
    if (check(this.state, action) === null) this.move(action)
  }

  /** A screen has shown every move up to its `seen`th event: all of them, unless a move came since. */
  done(seat: PlayerId, seen = this.saved.events.length) {
    if (seen < this.saved.events.length || !this.showing.delete(seat) || this.showing.size > 0) return
    this.cancel('pace')
    this.next()
  }

  dispose() {
    this.stopTimers()
    this.screens.clear()
  }

  private stopTimers() {
    this.timers.forEach((stop) => stop())
    this.timers.clear()
  }

  private isPerson = (seat: PlayerId | null): seat is PlayerId => seat !== null && this.cast[seat]?.bot === false

  private move(action: Action) {
    const { state, events } = apply(this.state, action)
    const { saved } = this
    saved.state = state
    saved.events.push(...events)
    saved.memory = saved.memory.map((m, id) => events.reduce((top, e) => remember(top, eventFor(e, id), id), m))
    // Whatever was about to happen no longer applies: a bot thinking, a window's clock.
    this.stopTimers()
    this.deadline = undefined
    this.host.save(saved)
    // Awaited before they're told: a screen in this tab says it's done as it hears.
    const seats = [...this.screens].map((s) => s.seat).filter(this.isPerson)
    this.await(seats)
    for (const s of this.screens) s.tell({ t: 'moved', view: view(state, s.seat), events: events.map((e) => eventFor(e, s.seat)) })
    if (seats.length === 0) this.next()
  }

  /** The table waits for these seats' screens to show what they're told, but never longer than the pace: a
   *  screen joining again and again never puts it off. */
  private await(seats: PlayerId[]) {
    if (seats.length === 0) return
    seats.forEach((seat) => this.showing.add(seat))
    if (this.timers.has('pace')) return
    this.schedule('pace', Clock.pace, () => {
      this.showing.clear()
      this.next()
    })
  }

  /** Every screen is up to date: the window's clock starts, or a bot takes its move. */
  private next() {
    const { state, cast } = this
    // With nobody left in the game, the bots' game means nothing.
    if (state.phase.t === 'over' || !cast.some((seat, id) => !seat.bot && state.players[id]!.alive)) return
    if (this.deadline || this.timers.has('think')) return
    const ph = state.phase
    if (ph.t === 'window') return this.startDeadline({ t: 'window', id: ph.id, ends: this.host.now() + Clock.window })
    const who = waitingOn(state)
    if (who === null) return
    if (!cast[who]!.bot) return this.wait(who)
    // A bot decides now, then takes a human moment to do it.
    const a = act(view(state, who), this.saved.memory[who]!, this.host.random)
    this.schedule('think', this.between(1, 2), () => this.bot(a))
  }

  /** A person's move, with someone else at the table, playing or watching: their clock runs. Alone with bots,
   *  they take their time. */
  private wait(seat: PlayerId) {
    if (![...this.screens].some((s) => s.seat !== seat)) return
    this.startDeadline({ t: 'clock', seat, ends: this.host.now() + Clock.move })
  }

  private startDeadline(deadline: Deadline) {
    this.deadline = deadline
    this.host.save(this.saved, deadline)
    this.runDeadline(deadline)
  }

  private runDeadline(deadline: Deadline) {
    if (this.expireDue()) return
    const left = deadline.ends - this.host.now()
    this.schedule(deadline.t, left, () => this.expire(deadline))
    const ph = this.state.phase
    if (ph.t === 'window') {
      for (const p of this.state.players) {
        if (!this.cast[p.id]!.bot || !p.alive || p.id === lastIn(ph)) continue
        // Late enough to have read the play, early enough to leave the others time to answer.
        this.schedule(`react${p.id}`, this.between(1.5, 2.5), () => {
          const a = react(view(this.state, p.id), this.host.random)
          if (a) this.bot(a)
        })
      }
    }
    this.screens.forEach((s) => this.tellDeadline(s, deadline))
  }

  private tellDeadline(screen: Screen, deadline: Deadline) {
    const left = Math.max(0, deadline.ends - this.host.now())
    screen.tell(deadline.t === 'window' ? { t: 'window', left } : { t: 'clock', seat: deadline.seat, left })
  }

  /** A late message may arrive before the timeout callback runs. */
  private expireDue(): boolean {
    const deadline = this.deadline
    if (!deadline || deadline.ends > this.host.now()) return false
    this.expire(deadline)
    return true
  }

  private expire(deadline: Deadline) {
    this.move(deadline.t === 'window' ? { t: 'expire', id: deadline.id } : { t: 'out', player: deadline.seat, why: 'time' })
  }

  /** A bot only makes legal moves (its tests play many games to show it). One that doesn't is a bug: it's told,
   *  and the bot goes out instead (a Nope just isn't made), so a game never stops. */
  private bot(action: Action) {
    if (this.expireDue()) return
    const reason = check(this.state, action)
    if (reason === null) return this.move(action)
    console.error(`illegal bot move (${reason}): ${JSON.stringify(action)}`)
    if (action.t !== 'nope' && action.t !== 'expire') this.move({ t: 'out', player: action.player, why: 'time' })
  }

  /** Runs `fn` in `s` seconds, replacing any timer under the same key. */
  private schedule(key: string, s: number, fn: () => void) {
    this.cancel(key)
    this.timers.set(
      key,
      this.host.after(s, () => {
        this.timers.delete(key)
        fn()
      }),
    )
  }

  private cancel(key: string) {
    this.timers.get(key)?.()
    this.timers.delete(key)
  }

  /** A human pause: anywhere from `lo` to `hi` seconds. */
  private between = (lo: number, hi: number) => lo + this.host.random() * (hi - lo)
}
