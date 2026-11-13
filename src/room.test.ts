import { describe, expect, it, vi } from 'vitest'
import { act, react } from './bot'
import { random, seeded, setup, view, waitingOn, type Action, type Card, type PlayerId, type State } from './engine'
import { Clock, Room, Version, type Cast, type Host, type Told } from './room'

/** A host whose clock moves only when told to. */
function host(seed: number) {
  const rng = { rng: seeded(seed) }
  let now = 0
  const timers = new Set<{ at: number; fn: () => void }>()
  return {
    after: (s: number, fn: () => void) => {
      const t = { at: now + s, fn }
      timers.add(t)
      return () => void timers.delete(t)
    },
    now: () => now,
    random: () => random(rng),
    save: () => {},
    /** Runs, in order, every timer due in the next `s` seconds. */
    run(s: number) {
      const end = now + s
      for (let t = first(); t && t.at <= end; t = first()) {
        timers.delete(t)
        now = t.at
        t.fn()
      }
      now = end
    },
  }
  function first() {
    return [...timers].sort((a, b) => a.at - b.at)[0]
  }
}

const cast = (...bots: boolean[]): Cast => bots.map((bot, face) => ({ face, name: '', bot }))

/** A dealt table where `current` is on turn, seat 0 holds a Nope (id 900) and `current` a Skip (id 901). */
function table(seats: Cast, current: PlayerId, h: Host) {
  const state = setup(seats.length, 1)
  state.current = current
  state.players[0]!.hand.push({ id: 900, kind: 'nope' })
  state.players[current]!.hand.push({ id: 901, kind: 'skip' })
  return new Room({ v: Version, deal: 1, state, cast: seats, memory: seats.map(() => []), events: [] }, h)
}

/** A screen that writes down what it hears, and says it's done at once unless told to lag. */
function screen(room: Room, seat: PlayerId | null, lag = false) {
  const heard: Told[] = []
  const shown = (told: Told) => told.t === 'table' || told.t === 'moved'
  room.join({ seat, tell: (told) => (heard.push(told), !lag && shown(told) && seat !== null && room.done(seat)) })
  return heard
}

const skip: Action = { t: 'play', player: 1, cards: [901] }

describe('room', () => {
  it('waits for every screen at the table to show a move, but no longer than the pace', () => {
    for (const lag of [false, true]) {
      const h = host(3)
      const room = table(cast(false, false, true), 1, h)
      const quick = screen(room, 0)
      const slow = screen(room, 1, true)
      screen(room, null, true) // someone watching never holds the table
      room.done(1)
      room.act(1, skip)
      // A done meant for the move before, arriving after this one, doesn't count for it.
      room.done(1, lag ? 0 : undefined)
      const opened = (heard: Told[]) => heard.some((t) => t.t === 'window')
      expect(opened(quick)).toBe(!lag)
      h.run(Clock.pace)
      expect([opened(quick), opened(slow)]).toEqual([true, true])
    }
  })

  it('waits no longer than the pace, however often a screen comes back', () => {
    const h = host(3)
    const room = table(cast(false, false), 1, h)
    const quick = screen(room, 0)
    screen(room, 1, true)
    room.act(1, skip)
    for (let i = 0; i < 3; i++) {
      h.run(Clock.pace / 3)
      screen(room, 1, true) // a reload, again and again, never done
    }
    expect(quick.some((t) => t.t === 'window')).toBe(true)
  })

  it('keeps a window to its time when a screen joins again mid-way, and tells it what is left', () => {
    const h = host(4)
    const room = table(cast(false, false), 1, h)
    screen(room, 0)
    const leave = room.join({ seat: 1, tell: (told) => told.t !== 'window' && room.done(1) })
    room.act(1, skip)
    h.run(3)
    leave()
    const back = screen(room, 1) // a reload
    expect(back.find((t) => t.t === 'window')).toEqual({ t: 'window', left: 2 })
    h.run(2.01)
    expect(room.state.phase.t).toBe('turn')
  })

  it('restores the same Nope window with its original deadline', () => {
    const h = { ...host(4), save: vi.fn<Host['save']>() }
    const room = table(cast(false, false), 1, h)
    screen(room, 0)
    screen(room, 1)
    room.act(1, skip)
    h.run(3)
    room.dispose()
    const [saved, deadline] = structuredClone(h.save.mock.lastCall!)
    const restored = new Room(saved, h, deadline)
    restored.resume()
    const back = screen(restored, 0)
    expect(back.find((t) => t.t === 'window')).toEqual({ t: 'window', left: 2 })
    h.run(2)
    expect(restored.state.phase.t).toBe('turn')
  })

  it('gives a person their time while someone else waits, none alone with bots; then they are out', () => {
    const h = host(6)
    const alone = table(cast(false, true), 0, h)
    const quiet = screen(alone, 0)
    h.run(Clock.move * 2)
    expect([quiet.some((t) => t.t === 'clock'), alone.state.players[0]!.alive]).toEqual([false, true])

    const room = table(cast(false, false, true), 0, h)
    screen(room, 0)
    const leave = room.join({ seat: 1, tell: (told) => (told.t === 'table' || told.t === 'moved') && room.done(1) })
    h.run(10)
    leave()
    const back = screen(room, 1) // a reload doesn't restart it
    expect(back.find((t) => t.t === 'clock')).toEqual({ t: 'clock', seat: 0, left: Clock.move - 10 })
    h.run(Clock.move - 10.01)
    expect(room.state.players[0]!.alive).toBe(true)
    h.run(0.02)
    expect(room.saved.events.at(-1)).toMatchObject({ t: 'out', player: 0, why: 'time' })

    // Someone only watching waits too: a person gone from the table runs out of time.
    const gone = table(cast(false, true), 0, h)
    screen(gone, null)
    h.run(Clock.move + 0.01)
    expect(gone.state.players[0]!.alive).toBe(false)
  })

  it('takes a move only from its own seat, and a Nope only once its window is seen', () => {
    const h = host(5)
    const bots = table(cast(false, true), 1, h)
    screen(bots, 0)
    bots.act(1, skip) // a bot's seat is the room's to play
    expect(bots.state.phase.t).toBe('turn')

    const room = table(cast(false, false), 1, h)
    screen(room, 0, true)
    screen(room, 1, true)
    ;[0, 1].forEach((seat) => room.done(seat))
    room.act(0, skip) // another seat's move
    room.act(1, { t: 'expire', id: 0 })
    expect(room.state.phase.t).toBe('turn')
    room.act(1, skip)
    const ph = room.state.phase
    const nope = { t: 'nope', player: 0, card: 900, id: ph.t === 'window' ? ph.id : -1 } as const
    room.act(0, nope) // before its play has been seen
    expect(room.state.phase).toEqual(ph)
    ;[0, 1].forEach((seat) => room.done(seat))
    room.act(0, nope)
    expect(room.state.phase).not.toEqual(ph)
  })

  it("deals seats anew each game, and tells each screen its own seat's share, someone watching only what's public", () => {
    const seats = new Set<PlayerId>()
    for (let seed = 1; seed <= 6; seed++) {
      const h = host(seed)
      const room = Room.start(cast(false, true, true), h)
      const me = room.cast.findIndex((s) => !s.bot)
      seats.add(me)
      const checks: (() => void)[] = []
      for (const seat of [me, null]) {
        room.join({
          seat,
          tell: (told) => {
            const state = room.state
            if (told.t === 'table' || told.t === 'moved') {
              checks.push(() => secret(told, state, seat))
              if (seat !== null) room.done(seat)
            }
          },
        })
      }
      const rand = () => h.random()
      for (let i = 0; state(room).phase.t !== 'over' && state(room).players[me]!.alive; i++) {
        if (i > 5000) throw new Error('the game did not end')
        const s = state(room)
        const v = view(s, me)
        const a = s.phase.t === 'window' ? react(v, rand) : waitingOn(s) === me ? act(v, [], rand) : null
        if (a) room.act(me, a)
        h.run(0.5)
      }
      checks.forEach((check) => check())
      room.dispose()
    }
    expect(seats.size).toBeGreaterThan(1)
  })
})

const state = (room: Room) => room.state

/** The view hides every card where `seat` can't see it: in the deck, the box, or another hand. Someone
 *  watching hears no such card in any event either, but for a triple's catch, which is public. */
function secret(told: Extract<Told, { view: unknown }>, s: State, seat: PlayerId | null) {
  const hidden = new Set([...s.deck, ...s.box, ...s.players.filter((p) => p.id !== seat).flatMap((p) => p.hand)].map((c) => c.id))
  const events = seat === null ? told.events.filter((e) => !(e.t === 'moved' && e.via === 'triple')) : []
  expect(cardsIn([told.view, events]).filter((c) => hidden.has(c.id))).toEqual([])
}

function cardsIn(v: unknown, out: Card[] = []): Card[] {
  if (Array.isArray(v)) v.forEach((x) => cardsIn(x, out))
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.id === 'number' && typeof o.kind === 'string') out.push(o as unknown as Card)
    else Object.values(o).forEach((x) => cardsIn(x, out))
  }
  return out
}
