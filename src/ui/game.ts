import { isCat, view, type Action, type Card, type Event, type Kind, type PlayerId, type View } from '../engine'
import { Clock, Room, Version, type Saved, type Told } from '../room'
import { after, forget, listen, load, now, save } from './browser'
import { Hold, Hurry, Slam, Spring, Time } from './design'
import { atDeck, playEvent, sfx } from './sound'
import {
  doneFor,
  ended,
  grab,
  handId,
  isMe,
  onTurn,
  sheet,
  targets,
  threat,
  twins,
  type Beat,
  type Entry,
  type LogLine,
  type Move,
  type Shown,
  type Snapshot,
} from './table'
import { Characters } from '../lobby'
import { logEntry } from './words'

// Your screen at the table: it shows each move the room tells it as beats, and makes yours. While a beat
// plays, nobody acts; only a sheet already risen may cut it short (see `answer`).

/** An entry with no beat to show it waits in the queue until the beats before it have played. */
type Note = { t: 'note'; entry: Entry }

/** The moments worth a sound of their own: your turn, a play that would cost you, the end. */
interface Calls {
  turn: boolean
  threat: number | null
  over: boolean
}

/** The way to the room. */
interface Link {
  /** Takes a seat at the table, to hear what happens there; returns the way out. */
  join: (hear: (told: Told) => void) => () => void
  act: (action: Action) => void
  /** Every move up to the `seen`th event has been shown. */
  done: (seen: number) => void
}

let games = 0

/** Every game this screen runs: one that breaks stops them all (failed.tsx), or bots would play on behind it. */
const running = new Set<Game>()
export const stopAll = () => running.forEach((game) => game.dispose())

export class Game {
  readonly id = ++games
  /** The game's own number, from the room. */
  readonly deal: number
  /** Your seat; null when you're watching. */
  readonly me: PlayerId | null
  snap: Snapshot
  private queue: (Beat | Note)[] = []
  private listeners = new Set<() => void>()
  /** Each running timer's cancel, by key. */
  private timers = new Map<string, () => void>()
  private started = false
  private settling = false
  private heard: Calls
  /** The room waits to hear that you've seen its last move. */
  private owed = true
  /** Events heard so far: the room counts a done only for its latest move. */
  private seen: number
  /** Your last move was a card dropped right on its zone: it has landed already. */
  private inPlace = false
  /** A move is on its way to the room, not yet heard back: a second press (a double tap) sends nothing. */
  private sent = false
  private leave = () => {}

  constructor(
    private link: Link,
    table: Table,
  ) {
    this.deal = table.deal
    this.me = table.view.me
    this.seen = table.events.length
    // A game nobody has moved in yet is dealt; one picked up again starts where it was.
    this.snap = { ...seated(table), beat: table.events.length === 0 ? { t: 'deal' } : null }
    this.heard = this.calls()
  }

  /** Where things stand, told again after the line to the room dropped: straight to the present, no beats. */
  reset(table: Table) {
    this.cancelBeat()
    this.queue = []
    this.owed = true
    this.seen = table.events.length
    this.heardBack()
    // A clock still running is told again right after: one that isn't must not linger.
    this.stopClock()
    this.set({ ...seated(table), offline: this.snap.offline, watching: this.snap.watching })
    this.pump()
  }

  /** Out of a game with friends, you watch it to the end; or it ends for you, with nothing left to watch. */
  watch(watching: boolean) {
    if (watching !== this.snap.watching) this.set({ watching })
  }

  setOffline(offline: boolean) {
    if (offline === this.snap.offline) return
    this.heardBack()
    this.set({ offline, draft: null })
  }

  /** You leave the game with friends: you're out of it. */
  quit() {
    const { me, players, phase } = this.snap.view
    if (me !== null && players[me]!.alive && phase.t !== 'over') this.link.act({ t: 'out', player: me, why: 'left' })
  }

  /** A game against bots, its room in this tab. `me` and `bots` are faces; the bots sit in that order. Every seat
   *  goes by its face's name, though yours shows as You. */
  static start(me: number, bots: number[]): Game {
    const cast = [me, ...bots].map((face, i) => ({ face, name: Characters[face]!.name, bot: i > 0 }))
    return solo(Room.start(cast, host()))
  }

  static resume(): Game | null {
    const saved = parseSaved(load('game'))
    if (!saved || doneFor(view(saved.state, seatOf(saved)))) {
      forget('game') // a save that can't be picked up again would otherwise crash every load
      return null
    }
    return solo(new Room(saved, host()))
  }

  /** The clock starts once someone watches, so a game never shown never runs: not even its room. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    if (!this.started) {
      this.started = true
      running.add(this)
      const leave = this.link.join((told) => this.hear(told))
      const away = listen(document, 'visibilitychange', () => document.hidden && this.skip())
      this.leave = () => {
        away()
        leave()
      }
      if (this.snap.beat) this.begin(this.snap.beat)
      else this.pump()
    }
    return () => this.listeners.delete(fn)
  }

  dispose() {
    running.delete(this)
    this.timers.forEach((stop) => stop())
    this.timers.clear()
    this.listeners.clear()
    this.leave()
  }

  abandon() {
    this.dispose()
    forget('game')
  }

  /** What the room tells this screen; where things stand, it knew from the start. */
  hear(told: Told) {
    if (told.t === 'window') this.set({ windowAt: now() - (Clock.window - told.left) })
    if (told.t === 'clock') this.time(told.seat, told.left)
    if (told.t === 'moved') {
      this.heardBack()
      this.seen += told.events.length
      this.stopClock()
      this.show(told.view, told.events)
    }
  }

  private stopClock() {
    for (const key of [...this.timers.keys()]) if (key.startsWith('clock')) this.cancel(key)
    if (this.snap.clock) this.set({ clock: null })
  }

  /** A move's clock emphasizes its final seconds and sounds them for you alone. */
  private time(seat: PlayerId, left: number) {
    this.stopClock()
    const ends = now() + left
    this.set({ clock: { seat, ends, near: left <= Hurry.show } })
    if (left > Hurry.show) this.schedule('clock', left - Hurry.show, () => this.set({ clock: { seat, ends, near: true } }))
    if (seat === this.me) for (let s = 1; s <= Hurry.tick; s++) if (left > s) this.schedule(`clock${s}`, left - s, () => sfx('tick'))
  }

  /** The move `shown` makes now (see `grab`). `picked`: the one it made as a press picked it up, which a drop or
   *  tap still makes only if the moment hasn't moved on (a Nope picked up for a play no longer there).
   *  `inPlace`: dropped right on its zone, so it has landed. Whether a move went to the room. */
  make(shown: Shown, picked?: Move, inPlace = false): boolean {
    const move = grab(this.snap, shown)?.move
    if (!move || (picked && JSON.stringify(picked) !== JSON.stringify(move))) return false
    if (move.t !== 'play') return this.send(move, inPlace)

    const { card } = move
    // A Favor or a cat asks its questions on a sheet first.
    if (card.kind === 'favor' || isCat(card.kind)) {
      const cards = twins(this.snap.view, card)
      this.set({ draft: { step: cards.length === 3 ? 'size' : 'target', cards } })
      return false
    }
    return this.send({ t: 'play', player: this.me!, cards: [card.id] }, inPlace)
  }

  chooseSize(size: 2 | 3) {
    const d = this.snap.draft
    if (d?.step === 'size') this.set({ draft: { step: 'target', cards: d.cards.slice(0, size) } })
  }

  chooseTarget(target: PlayerId) {
    const d = this.snap.draft
    if (d?.step !== 'target' || !targets(this.snap.view).includes(target)) return
    if (d.cards.length === 3) return this.set({ draft: { step: 'name', cards: d.cards, target } })
    this.send({ t: 'play', player: this.me!, cards: d.cards.map((c) => c.id), target })
  }

  chooseName(named: Kind) {
    const d = this.snap.draft
    if (d?.step === 'name') this.send({ t: 'play', player: this.me!, cards: d.cards.map((c) => c.id), target: d.target, named })
  }

  cancelDraft() {
    if (this.snap.draft) this.set({ draft: null })
  }

  give(card: Card) {
    this.answer('give', { t: 'give', player: this.me!, card: card.id })
  }

  pick(index: number) {
    this.answer('pick', { t: 'pick', player: this.me!, index })
  }

  /** Hides your kitten `index` cards from the top, or anywhere at random. */
  hide(index = Math.floor(Math.random() * (this.snap.view.deck + 1))) {
    this.answer('place', { t: 'place', player: this.me!, index })
  }

  dismissFuture() {
    if (this.snap.beat?.t === 'future') this.finish()
  }

  /** A sheet may rise while a play resolves: answering it ends that wait early. */
  private answer(asked: ReturnType<typeof sheet>, action: Action) {
    if (sheet(this.snap) !== asked) return
    // Sent before the beat ends: the room must hear your answer before it hears you've caught up, or it starts your clock.
    this.send(action)
    if (this.snap.beat?.t === 'resolve') {
      this.cancelBeat()
      this.finish()
    }
  }

  private send(action: Action, inPlace = false) {
    if (this.sent) return false
    // Cleared as the room answers with the move, or as the line drops or returns; a move it turns down gets no
    // answer, so in time anyway.
    this.sent = true
    this.schedule('sent', Clock.pace, () => (this.sent = false))
    this.inPlace = inPlace
    this.link.act(action)
    return true
  }

  private heardBack() {
    this.sent = false
    this.cancel('sent')
  }

  /** Away (a hidden tab, whose timers crawl), the table goes straight to the present, so it holds nobody up:
   *  what happened is told in the log. */
  private skip() {
    const { beat } = this.snap
    if (!beat) return
    // A peek waits for you, and holds nobody up: it stays.
    const keep = beat.t === 'future'
    if (!keep) this.cancelBeat()
    const entries = [...(keep ? [] : [beat]), ...this.queue].flatMap((b) => (b.t === 'note' ? [b.entry] : b.entry ? [b.entry] : []))
    this.queue = []
    this.set({ ...(!keep && { beat: null }), log: append(this.snap.log, entries) })
    if (keep) this.caughtUp()
    else this.pump()
  }

  /** A move, as your seat saw it: each event queues the beat that shows it. */
  private show(after: View, events: Event[]) {
    const before = this.snap.view
    // A card nobody at your seat may see travels as the newest card of the hand it joins.
    const unseen = (player: PlayerId) => ({ id: handId(player, after.players[player]!.cards - 1), kind: null })
    // A Favor or pair that went through stays on stage until its card changes hands.
    const holds = after.phase.t === 'favor' || after.phase.t === 'steal'
    let held = this.snap.held
    // Out, and not watching: the end sheet is up, and the game goes on behind it in silence, without a beat
    // that would put the sheet away. Away, it goes on in silence too (see `skip`).
    const quiet = (doneFor(before) && !this.snap.watching) || document.hidden

    for (const e of events) {
      // The first beat that shows this event tells it; with no beat, it's told once the beats before it have played.
      let entry = logEntry(e, { view: after, cast: this.snap.cast })
      if (e.t === 'resolved' && holds) held = e.pending.cards
      if (quiet) {
        if (entry) this.queue.push({ t: 'note', entry })
        continue
      }
      const show = (beat: Beat) => {
        this.queue.push(entry ? { ...beat, entry } : beat)
        entry = null
      }
      playEvent(e, before, this.inPlace)
      switch (e.t) {
        case 'played':
        case 'noped':
          // A bot's card flies in from its avatar; its Nope window opens once it has landed.
          if (!isMe(after, e.t === 'played' ? e.pending.player : e.player)) show({ t: 'land', prior: before })
          break
        case 'drew':
          show({ t: 'draw', player: e.player, card: e.card ?? unseen(e.player), step: 'travel' })
          break
        case 'out':
          // A kitten in hand goes off; with none, one leaves the deck, never which one.
          if (e.kitten) show({ t: 'boom', player: e.player, kitten: e.kitten, hand: e.hand })
          else show({ t: 'out', player: e.player, kitten: { id: leaving(e.player), kind: 'exploding-kitten' }, hand: e.hand })
          break
        case 'exploded': {
          const { hand } = e
          // Until the reveal they still hold their hand, so nothing gives the kitten away early.
          const draw = this.queue.findLast((b) => b.t === 'draw' && b.player === e.player)
          if (draw?.t === 'draw') draw.hand = hand
          show({ t: 'boom', player: e.player, kitten: after.players[e.player]!.kitten!, hand })
          break
        }
        case 'moved': {
          // The card crosses the stage straight from its giver, over the play that asked for it.
          const last = this.queue.at(-1)
          if (last?.t === 'resolve') this.queue.pop()
          const done = [...held, ...(last?.t === 'resolve' ? last.cards : [])]
          show({ t: 'pass', card: e.card ?? unseen(e.to), from: e.from, to: e.to, done, step: 'held' })
          show({ t: 'resolve', cards: done, noped: false, step: 'drop' })
          break
        }
        case 'missed':
          show({ t: 'missed' })
          break
        case 'saw':
          if (isMe(after, e.player)) show({ t: 'future', cards: e.cards })
          break
        case 'resolved': {
          const nopes = before.phase.t === 'window' ? before.phase.nopes.map((n) => n.card) : []
          show({ t: 'resolve', cards: [...(holds ? [] : e.pending.cards), ...nopes], noped: e.noped, step: 'drop' })
          break
        }
        case 'defused':
          show({ t: 'defuse' })
          break
        case 'placed':
          if (before.phase.t === 'place') {
            const { card: kitten, defuse } = before.phase
            show({ t: 'place', player: e.player, kitten, defuse, step: 'slide' })
          }
          break
        case 'shuffled': {
          const last = this.queue.at(-1)
          if (last?.t === 'resolve') last.shuffle = true
          break
        }
      }
      if (entry) this.queue.push({ t: 'note', entry })
    }

    this.inPlace = false
    this.owed = true
    // A new Nope window's clock is the room's to start: until it says, nobody can Nope.
    const opened = after.phase.t === 'window' && (before.phase.t !== 'window' || before.phase.id !== after.phase.id)
    this.set({ view: after, draft: null, held: holds ? held : [], ...(opened && { windowAt: null }) })
    if (this.snap.beat?.t === 'future' && doneFor(after)) this.finish()
    else this.pump()
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch }
    // Announce once the table has settled: a move sets its state, then begins the beat that shows it.
    if (!this.settling) {
      this.settling = true
      queueMicrotask(() => {
        this.settling = false
        this.announce()
      })
    }
    this.listeners.forEach((fn) => fn())
  }

  private calls(): Calls {
    return { turn: isMe(this.snap.view, onTurn(this.snap)), threat: threat(this.snap), over: ended(this.snap) }
  }

  private announce() {
    const calls = this.calls()
    const { heard } = this
    const { me, players } = this.snap.view
    if (calls.turn && !heard.turn) sfx('turn', Time.land) // as the sun reaches you
    if (calls.threat !== null && calls.threat !== heard.threat) sfx('alert')
    // Out, then watching to the end: the end you heard as you went out.
    if (calls.over && !heard.over && me !== null && !this.snap.watching) sfx(players[me]!.alive ? 'win' : 'lose')
    this.heard = calls
  }

  /** Runs `fn` in `s` seconds, replacing any timer under the same key. */
  private schedule(key: string, s: number, fn: () => void) {
    this.cancel(key)
    this.timers.set(
      key,
      after(s, () => {
        this.timers.delete(key)
        fn()
      }),
    )
  }

  private cancel(key: string) {
    this.timers.get(key)?.()
    this.timers.delete(key)
  }

  /** Stops the current beat's cues and end: every timer keyed `beat…`. */
  private cancelBeat() {
    for (const key of [...this.timers.keys()]) if (key.startsWith('beat')) this.cancel(key)
  }

  /** Plays the next beat; with none left, tells the room this screen has shown everything. */
  private pump() {
    if (this.snap.beat) return
    let next = this.queue.shift()
    while (next && (next.t === 'note' || (next.t === 'future' && doneFor(this.snap.view)))) {
      if (next.entry) this.write(next.entry)
      next = this.queue.shift()
    }
    if (next) return this.begin(next)
    this.caughtUp()
  }

  private caughtUp() {
    if (!this.owed) return
    this.owed = false
    this.link.done(this.seen)
  }

  private begin(beat: Beat) {
    this.set({ beat })
    // A peek waits for you alone: the table needn't.
    if (beat.t === 'future' && this.queue.every((b) => b.t === 'note')) this.caughtUp()
    const { cues, end } = timeline(beat, this.snap.view)
    cues.forEach(({ at, step, sound }, i) =>
      this.schedule(`beat${i}`, at, () => {
        if (step) this.set({ beat: { ...this.snap.beat!, step } as Beat })
        if (sound) sfx(...sound)
      }),
    )
    if (end !== null) this.schedule('beat', end, () => this.finish())
  }

  private finish() {
    const entry = this.snap.beat?.entry
    this.set({ beat: null })
    if (entry) this.write(entry)
    this.pump()
  }

  private write(entry: Entry) {
    this.set({ log: append(this.snap.log, [entry]) })
  }
}

type Table = Extract<Told, { t: 'table' }>

/** The kitten that leaves the deck with someone, by an id of its own (between the deck's and the hands'):
 *  which one it was is never told. */
const leaving = (player: PlayerId) => -900 - player

/** The table as a seat finds it: what it saw happen in the log, and a Favor or pair being answered on stage. */
function seated({ cast, view, events }: Table): Snapshot {
  const asking = view.phase.t === 'favor' || view.phase.t === 'steal'
  const held = asking ? (events.findLast((e) => e.t === 'resolved')?.pending.cards ?? []) : []
  const told = events.flatMap((e) => logEntry(e, { view, cast }) ?? [])
  return { view, cast, beat: null, draft: null, windowAt: null, offline: false, watching: false, clock: null, held, log: append([], told) }
}

/** A screen for a room in this tab, at the one seat a bot doesn't play. */
function solo(room: Room): Game {
  const seat = seatOf(room)
  const link: Link = {
    join: (hear) => {
      // The screenshots (scripts/shots.mjs) drive the bots through it.
      if (import.meta.env.DEV) Object.assign(globalThis, { room })
      const leave = room.join({ seat, tell: hear })
      return () => {
        leave()
        room.dispose()
      }
    },
    act: (a) => room.act(seat, a),
    done: (seen) => room.done(seat, seen),
  }
  return new Game(link, room.table(seat))
}

const seatOf = ({ cast }: { cast: Saved['cast'] }) => cast.findIndex((s) => !s.bot)

/** The room's needs, from this tab: its game is saved until it's over for you. */
const host = () => ({
  after,
  now,
  random: Math.random,
  save: (saved: Saved) => (doneFor(view(saved.state, seatOf(saved))) ? forget('game') : save('game', saved)),
})

/** The save, if it is this version's and holds together. */
function parseSaved(value: unknown): Saved | undefined {
  if (!isRecord(value) || value.v !== Version) return undefined
  const { state, cast, memory, events } = value
  if (!isRecord(state) || !Array.isArray(state.players) || !isRecord(state.phase)) return undefined
  const seats = state.players.length
  const whole =
    Array.isArray(cast) &&
    cast.length === seats &&
    cast.every(
      (s) => isRecord(s) && Characters[s.face as number] !== undefined && typeof s.name === 'string' && typeof s.bot === 'boolean',
    ) &&
    cast.filter((s) => !s.bot).length === 1 &&
    Array.isArray(memory) &&
    memory.length === seats &&
    Array.isArray(events)
  // Safe: each field `Saved` names is checked above, and what they hold is this version's own.
  return whole ? (value as unknown as Saved) : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** A cue `at` seconds into a beat: the step it moves to, a sound, or both. */
type Mark = { at: number; step?: string; sound?: Parameters<typeof sfx> }

/** A beat's cues and when it ends (null: it waits for you). */
function timeline(beat: Beat, view: View): { cues: Mark[]; end: number | null } {
  switch (beat.t) {
    case 'deal':
      // Your last card leaves the deck after the others, then flies and turns over.
      return {
        cues: [{ at: 0, sound: ['deal', 0, atDeck()] }],
        end: (view.hand.length - 1) * Time.dealStep + Time.fade + Spring.move.visualDuration,
      }
    case 'draw': {
      const reveal = Hold.travel + Hold.suspense
      const cues: Mark[] = [
        { at: 0, sound: ['slide', 0, atDeck(!isMe(view, beat.player))] },
        { at: Hold.travel, step: 'suspense' },
        { at: reveal, step: 'reveal' },
      ]
      if (beat.card.kind === 'exploding-kitten') {
        // It stays on stage: no settle. Its low note sounds as its slam peaks.
        const doomed = isMe(view, beat.player) && beat.hand !== undefined
        return { cues: [...cues, { at: reveal, sound: ['kitten', Slam.peak] }], end: reveal + (doomed ? Hold.doomed : Hold.kitten) }
      }
      // A bot's card is never shown to you, so it goes straight on.
      const settle = reveal + (isMe(view, beat.player) ? Hold.reveal : 0)
      return { cues: [...cues, { at: settle, step: 'settle' }], end: settle + Hold.settle }
    }
    case 'pass':
      return { cues: [{ at: Hold.pass, step: 'home' }], end: Hold.pass + Hold.home }
    case 'boom':
      return { cues: [{ at: 0, sound: ['boom'] }], end: isMe(view, beat.player) ? Hold.boom / 2 : Hold.boom }
    case 'out':
      return { cues: [{ at: 0, sound: ['slide', 0, atDeck()] }], end: Hold.out }
    case 'future':
      return { cues: [], end: null }
    case 'land':
      return { cues: [], end: Time.cueLand }
    case 'resolve':
      if (!beat.shuffle) return { cues: [], end: Hold.resolve }
      // The deck parts, then its halves riffle together.
      return {
        cues: [
          { at: Hold.resolve, step: 'cut' },
          { at: 2 * Hold.resolve, step: 'close', sound: ['shuffle', 0, atDeck()] },
        ],
        end: 3 * Hold.resolve,
      }
    case 'defuse':
      return { cues: [], end: Hold.defuse }
    case 'place':
      return { cues: [{ at: Hold.place / 2, step: 'hidden' }], end: Hold.place }
    case 'missed':
      return { cues: [], end: Hold.missed }
  }
}

const append = (log: LogLine[], entries: Entry[]) => [...log, ...entries.map((e, i) => ({ id: (log.at(-1)?.id ?? 0) + 1 + i, ...e }))]
