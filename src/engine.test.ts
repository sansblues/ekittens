import { describe, expect, it } from 'vitest'
import {
  Kinds,
  Nameable,
  random,
  type Card,
  type Kind,
  alive,
  apply,
  check,
  eventFor,
  seeded,
  setup,
  targetOf,
  view,
  waitingOn,
  type Action,
  type Event,
  type PlayerId,
  type Rng,
  type State,
} from './engine'

let nextId = 1000
const card = (kind: Kind): Card => ({ id: nextId++, kind })

/** Cards from space-separated kinds, e.g. 'skip nope'. */
function cards(kinds: string): Card[] {
  return kinds
    .split(' ')
    .filter(Boolean)
    .map((k) => {
      if (!Kinds.includes(k as Kind)) throw new Error(`unknown kind: ${k}`)
      return card(k as Kind)
    })
}

/** A hand-built table; the deck lists its top first. */
function table(hands: string[], deck = '', { dead = [], ...rest }: Partial<State> & { dead?: PlayerId[] } = {}): State {
  return {
    players: hands.map((h, id) => {
      const out = dead.includes(id)
      return { id, hand: cards(h), alive: !out, kitten: out ? card('exploding-kitten') : null }
    }),
    deck: cards(deck),
    discard: [],
    current: 0,
    turns: 1,
    attacked: false,
    phase: { t: 'turn' },
    windows: 0,
    rng: seeded(42),
    box: [],
    ...rest,
  }
}

const kinds = (cs: Card[]) => cs.map((c) => c.kind).join(' ')
const hand = (s: State, player: PlayerId) => kinds(s.players[player]!.hand)
const idOf = (s: State, player: PlayerId, kind: Kind, nth = 0) => s.players[player]!.hand.filter((c) => c.kind === kind)[nth]!.id
const windowId = (s: State) => (s.phase.t === 'window' ? s.phase.id : -1)

/** An action, or one built from the state it's applied to. */
type Step = Action | ((s: State) => Action)

function run(s: State, ...steps: Step[]) {
  const events: Event[] = []
  for (const step of steps) {
    const r = apply(s, typeof step === 'function' ? step(s) : step)
    s = r.state
    events.push(...r.events)
  }
  return { s, events }
}

const play =
  (player: PlayerId, kind: Kind, { n = 1, target, named }: { n?: number; target?: PlayerId; named?: Kind } = {}) =>
  (s: State): Action => ({ t: 'play', player, cards: Array.from({ length: n }, (_, i) => idOf(s, player, kind, i)), target, named })
const nope =
  (player: PlayerId) =>
  (s: State): Action => ({ t: 'nope', player, card: idOf(s, player, 'nope'), id: windowId(s) })
const defuse =
  (player: PlayerId, nth = 0) =>
  (s: State): Action => ({ t: 'defuse', player, card: idOf(s, player, 'defuse', nth) })
const give =
  (player: PlayerId, kind: Kind) =>
  (s: State): Action => ({ t: 'give', player, card: idOf(s, player, kind) })
const expire = (s: State): Action => ({ t: 'expire', id: windowId(s) })
const draw = (player: PlayerId): Action => ({ t: 'draw', player })
const place = (player: PlayerId, index: number): Action => ({ t: 'place', player, index })
const pick = (player: PlayerId, index: number): Action => ({ t: 'pick', player, index })

/** One table in every phase but over. Each seat holds the cards to move out of turn, so only the rules stop it. */
const base = table(['favor tacocat tacocat defuse', 'skip nope defuse'], 'exploding-kitten skip')
const phases = [
  base,
  run(base, play(0, 'favor', { target: 1 })).s,
  run(base, play(0, 'favor', { target: 1 }), expire).s,
  run(base, play(0, 'tacocat', { n: 2, target: 1 }), expire).s,
  run(base, draw(0)).s,
  run(base, draw(0), defuse(0)).s,
]

describe('setup', () => {
  it.each([2, 3, 4, 5])('deals a %i-player game', (n) => {
    const s = setup(n, 7)
    const count = (cs: Card[], kind: Kind) => cs.filter((c) => c.kind === kind).length
    const defuses = n === 2 ? 2 : 6 - n
    for (const p of s.players) expect([p.hand.length, count(p.hand, 'defuse'), count(p.hand, 'exploding-kitten')]).toEqual([8, 1, 0])
    // 46 cards are neither kitten nor Defuse: 7 per hand, the rest in the deck.
    expect([s.deck.length, count(s.deck, 'exploding-kitten'), count(s.deck, 'defuse')]).toEqual([
      46 - 7 * n + n - 1 + defuses,
      n - 1,
      defuses,
    ])
    expect([s.players.length, s.current, s.turns, s.phase]).toEqual([n, 0, 1, { t: 'turn' }])
  })
})

describe('turns', () => {
  it('puts a safe draw in hand and passes the turn to the next player alive', () => {
    const t = table(['', '', '', ''], 'skip exploding-kitten', { current: 3, dead: [0, 1] })
    const { s, events } = run(t, draw(3))
    expect([hand(s, 3), s.current]).toEqual(['skip', 2])
    expect(events).toEqual([{ t: 'drew', player: 3, card: t.deck[0] }])
  })

  it('waits on one player at a time, who may make only the move the phase asks for', () => {
    const moves = (s: State) => [...new Set(legal(s).map((a) => (a.t === 'expire' ? a.t : `${a.t} ${a.player}`)))]
    expect(phases.map((s) => [s.phase.t, waitingOn(s), moves(s)])).toEqual([
      ['turn', 0, ['draw 0', 'play 0']],
      ['window', null, ['expire', 'nope 1']],
      ['favor', 1, ['give 1']],
      ['steal', 0, ['pick 0']],
      ['kitten', 0, ['defuse 0']],
      ['place', 0, ['place 0']],
    ])
    expect(() => apply(base, draw(1))).toThrow('draw: not your turn')
  })
})

describe('exploding kittens', () => {
  it('without a Defuse: explode, discard the hand, keep the kitten', () => {
    const { s, events } = run(table(['skip nope', 'skip', 'skip'], 'exploding-kitten skip exploding-kitten'), draw(0))
    expect(s.players[0]).toMatchObject({ alive: false, hand: [], kitten: { kind: 'exploding-kitten' } })
    expect([kinds(s.discard), kinds(s.deck)]).toEqual(['skip nope', 'skip exploding-kitten'])
    expect(events.map((e) => e.t)).toEqual(['drew', 'exploded'])
  })

  it('leaves an attacked player owing the rest of their turns, until they explode', () => {
    let s = table(['', 'defuse', ''], 'exploding-kitten skip exploding-kitten', { current: 1, turns: 3, attacked: true })
    s = run(s, draw(1), defuse(1), place(1, 0)).s
    expect([s.current, s.turns, s.attacked]).toEqual([1, 2, true])
    s = run(s, draw(1)).s
    expect([s.players[1]!.alive, s.current, s.turns, s.attacked]).toEqual([false, 2, 1, false])
  })
})

describe('going out', () => {
  // Seat 0 is on turn in each phase; seat 1 owes the Favor or is stolen from; seat 2 only watches.
  const three = table(['favor tacocat tacocat defuse', 'skip nope defuse', 'skip'], 'exploding-kitten skip exploding-kitten skip')
  const at = phases.map((p) => ({ ...p, players: [...p.players, three.players[2]!], deck: three.deck }))

  it('ends what was theirs to do or give; a kitten in hand goes off, else the deck loses its lowest', () => {
    const after = (s: State, player: PlayerId) => {
      const r = run(s, { t: 'out', player, why: 'time' }).s
      const deckKittens = r.deck.filter((c) => c.kind === 'exploding-kitten').length
      return [r.phase.t, r.current, deckKittens, r.box.length, r.players[player]!.kitten?.kind ?? 'none'].join(' ')
    }
    // On turn: the turn passes, whatever the phase.
    expect(at.map((s) => after(s, 0))).toEqual([
      'turn 1 1 1 none',
      'turn 1 1 1 none',
      'turn 1 1 1 none',
      'turn 1 1 1 none',
      'turn 1 2 0 exploding-kitten',
      'turn 1 2 0 exploding-kitten',
    ])
    // Owing a Favor or stolen from: it finds nothing. A play aimed at them still waits out its window.
    expect(at.map((s) => after(s, 1))).toEqual([
      'turn 0 1 1 none',
      'window 0 1 1 none',
      'turn 0 1 1 none',
      'turn 0 1 1 none',
      'kitten 0 1 1 none',
      'place 0 1 1 none',
    ])
    expect(run(at[0]!, { t: 'out', player: 1, why: 'left' }).events.map((e) => e.t)).toEqual(['out'])
    // With two left, the other wins, even holding a kitten: theirs goes in the box.
    const two = run(phases[4]!, { t: 'out', player: 1, why: 'left' }).s
    expect([two.phase, two.box.map((c) => c.kind)]).toEqual([{ t: 'over', winner: 0 }, ['exploding-kitten']])
    expect(check(two, { t: 'out', player: 0, why: 'left' })).toBe('game over')
  })
})

describe('defuse and place', () => {
  it('places the kitten anywhere from top to bottom', () => {
    const s = run(table(['defuse', ''], 'exploding-kitten skip skip'), draw(0), defuse(0)).s
    for (const i of [0, 1, 2]) expect(run(s, place(0, i)).s.deck[i]!.kind).toBe('exploding-kitten')
    for (const i of [3, -1, 0.5]) expect(check(s, place(0, i))).toBe('invalid position')
  })

  it('hides the kitten under the id of any kitten in the deck, so a later draw never says which it was', () => {
    const s = run(table(['defuse', ''], 'exploding-kitten skip exploding-kitten exploding-kitten'), draw(0), defuse(0)).s
    const ids = new Set(Array.from({ length: 30 }, (_, n) => run({ ...s, rng: seeded(n) }, place(0, 0)).s.deck[0]!.id))
    expect(ids.size).toBe(3)
  })

  it('spends exactly one Defuse of your own', () => {
    const s = run(table(['defuse defuse skip', 'defuse'], 'exploding-kitten skip'), draw(0)).s
    for (const card of [idOf(s, 0, 'skip'), idOf(s, 1, 'defuse')]) expect(check(s, { t: 'defuse', player: 0, card })).toBe('no such defuse')
    const after = run(s, defuse(0, 1)).s
    expect([hand(after, 0), kinds(after.discard)]).toEqual(['defuse skip', 'defuse'])
  })
})

describe('playing', () => {
  it('rejects unplayable cards and combos', () => {
    const s = table(['nope defuse skip skip tacocat tacocat tacocat tacocat cattermelon', 'skip'])
    const id = (kind: Kind, nth = 0) => idOf(s, 0, kind, nth)
    const tryPlay = (cards: number[], target?: PlayerId) => check(s, { t: 'play', player: 0, cards, target })
    const tacocats = [0, 1, 2, 3].map((n) => id('tacocat', n))
    expect(tryPlay([id('nope')])).toBe('not playable')
    expect(tryPlay([id('defuse')])).toBe('not playable')
    expect(tryPlay([id('tacocat')], 1)).toBe('not playable')
    expect(tryPlay(tacocats, 1)).toBe('not playable')
    expect(tryPlay([id('skip'), id('skip', 1)])).toBe('not playable') // combos are cats only
    expect(tryPlay([id('tacocat'), id('cattermelon')], 1)).toBe('cards must match')
    expect(tryPlay([id('tacocat'), id('tacocat')], 1)).toBe('duplicate cards')
    expect(tryPlay([id('skip')], 1)).toBe('no target needed')
    for (const bad of [[], [idOf(s, 1, 'skip')]]) expect(tryPlay(bad)).toBe('card not in hand')
  })
})

describe('Nope', () => {
  it('cancels the play on an odd number of Nopes, from anyone', () => {
    const t = table(['skip nope', 'nope nope', 'nope'], 'skip')
    const turnAfter = (...nopes: Step[]) => run(t, play(0, 'skip'), ...nopes, expire).s.current
    expect(turnAfter()).toBe(1)
    expect(turnAfter(nope(1))).toBe(0)
    expect(turnAfter(nope(0))).toBe(0) // even the player's own
    expect(turnAfter(nope(1), nope(0))).toBe(1)
    expect(turnAfter(nope(1), nope(1))).toBe(1)
    expect(turnAfter(nope(1), nope(0), nope(2))).toBe(0)
    // Noped or not, the cards are spent.
    expect(kinds(run(t, play(0, 'skip'), nope(1), nope(0), nope(2), expire).s.discard)).toBe('skip nope nope nope')
  })

  it('opens a fresh window with each Nope and rejects stale ids', () => {
    const s0 = run(table(['skip', 'nope', 'nope']), play(0, 'skip')).s
    const s1 = run(s0, nope(1)).s
    const s2 = run(s1, nope(2)).s
    const [a, b, c] = [s0, s1, s2].map(windowId)
    for (const id of [a!, b!, c! + 1]) expect(check(s2, { t: 'expire', id })).toBe('no such window')
    // A Nope meant for one play never lands on the next.
    expect(check(s1, { t: 'nope', player: 2, card: idOf(s1, 2, 'nope'), id: a! })).toBe('no such window')
  })

  it('needs a Nope card of your own', () => {
    const s = run(table(['skip', 'nope skip']), play(0, 'skip')).s
    expect(check(s, { t: 'nope', player: 1, card: idOf(s, 1, 'skip'), id: windowId(s) })).toBe('no such nope')
    expect(check(s, { t: 'nope', player: 0, card: idOf(s, 1, 'nope'), id: windowId(s) })).toBe('no such nope')
  })

  it('knows who the play in the window is aimed at', () => {
    const t = table(['attack favor skip', '', 'skip', 'skip'], '', { dead: [1] })
    const aimed = (...steps: Step[]) => targetOf(run(t, ...steps).s)
    expect([aimed(), aimed(play(0, 'skip')), aimed(play(0, 'attack')), aimed(play(0, 'favor', { target: 3 }))]).toEqual([null, null, 2, 3])
  })
})

describe('Attack', () => {
  it('hands the next player alive 2 turns, plus any the attacker still owed', () => {
    const t = table(['', 'attack', 'attack', 'attack'], '', { current: 3, dead: [0] })
    const once = run(t, play(3, 'attack'), expire).s
    expect([once.current, once.turns]).toEqual([1, 2])
    const thrice = run(once, play(1, 'attack'), expire, play(2, 'attack'), expire).s
    expect([thrice.current, thrice.turns]).toEqual([3, 6])
    // On the second of two attacked turns, the one left carries over.
    const late = run(table(['attack', ''], 'skip', { turns: 2, attacked: true }), draw(0), play(0, 'attack'), expire).s
    expect([late.current, late.turns]).toEqual([1, 3])
  })
})

describe('Skip', () => {
  it('ends one turn; after the last, play passes and the Attack is spent', () => {
    const after = (turns: number) => {
      const s = run(table(['skip', ''], '', { turns, attacked: true }), play(0, 'skip'), expire).s
      return [s.current, s.turns, s.attacked]
    }
    expect([after(2), after(1)]).toEqual([
      [0, 1, true],
      [1, 1, false],
    ])
  })
})

describe('Shuffle and See the Future', () => {
  it('Shuffle reorders the deck and keeps the turn', () => {
    const t = table(['shuffle', ''], [...Kinds, ...Kinds].join(' '))
    const { s, events } = run(t, play(0, 'shuffle'), expire)
    const order = (s: State) => s.deck.map((c) => c.id)
    expect(order(s)).not.toEqual(order(t))
    expect(order(s).sort()).toEqual(order(t).sort())
    expect([s.current, events.at(-1)]).toEqual([0, { t: 'shuffled' }])
  })

  it('See the Future shows the top 3 and changes nothing', () => {
    const t = table(['see-the-future', ''], 'skip nope attack favor')
    const { s, events } = run(t, play(0, 'see-the-future'), expire)
    expect(events.at(-1)).toEqual({ t: 'saw', player: 0, cards: t.deck.slice(0, 3) })
    expect(s.deck).toEqual(t.deck)
  })
})

describe('Favor', () => {
  it('needs a target alive, not yourself, holding a card', () => {
    const s = table(['favor', '', 'skip', ''], '', { dead: [3] })
    const tryTarget = (target?: PlayerId) => check(s, { t: 'play', player: 0, cards: [idOf(s, 0, 'favor')], target })
    const invalid = 'invalid target'
    expect([undefined, 0, 1, 2, 3].map(tryTarget)).toEqual([invalid, invalid, invalid, null, invalid])
  })

  it('makes the target give a card of their choice', () => {
    const s = run(table(['favor', 'skip nope']), play(0, 'favor', { target: 1 }), expire).s
    expect(check(s, { t: 'give', player: 1, card: -1 })).toBe('card not in hand')
    const { s: after, events } = run(s, give(1, 'nope'))
    expect([hand(after, 0), hand(after, 1), after.phase.t, after.current]).toEqual(['nope', 'skip', 'turn', 0])
    expect(events).toEqual([{ t: 'moved', from: 1, to: 0, card: after.players[0]!.hand[0], via: 'favor' }])
  })

  it('misses if the target spent their last card on a Nope', () => {
    const { s, events } = run(table(['favor nope', 'nope']), play(0, 'favor', { target: 1 }), nope(1), nope(0), expire)
    expect([s.phase.t, events.at(-1)]).toEqual(['turn', { t: 'missed', player: 0, target: 1, named: null }])
  })
})

describe('cat combos', () => {
  it('a pair steals a blind card, picked by index', () => {
    const s = run(table(['tacocat tacocat', 'skip nope attack']), play(0, 'tacocat', { n: 2, target: 1 }), expire).s
    for (const i of [3, -1, 0.5]) expect(check(s, pick(0, i))).toBe('invalid pick')
    const taken = s.players[1]!.hand[1]
    const { s: after, events } = run(s, pick(0, 1))
    expect([after.players[0]!.hand, after.players[1]!.hand.length]).toEqual([[taken], 2])
    expect(events[0]).toEqual({ t: 'moved', from: 1, to: 0, card: taken, via: 'pair' })
  })

  it("a pair shuffles the victim's hand, so the pick can't be aimed", () => {
    const t = table(['tacocat tacocat', Nameable.join(' ')])
    const s = run(t, play(0, 'tacocat', { n: 2, target: 1 }), expire).s
    const order = (s: State) => s.players[1]!.hand.map((c) => c.id)
    expect(order(s)).not.toEqual(order(t))
    expect(order(s).sort()).toEqual(order(t).sort())
  })

  it('a triple takes one card of the named kind, or misses', () => {
    const t = table(['beard-cat beard-cat beard-cat', 'defuse skip defuse'])
    const hit = run(t, play(0, 'beard-cat', { n: 3, target: 1, named: 'defuse' }), expire)
    expect([hand(hit.s, 0), hand(hit.s, 1)]).toEqual(['defuse', 'skip defuse'])
    expect(hit.events.at(-1)).toEqual({ t: 'moved', from: 1, to: 0, card: t.players[1]!.hand[0], via: 'triple' })
    const miss = run(t, play(0, 'beard-cat', { n: 3, target: 1, named: 'nope' }), expire)
    expect([hand(miss.s, 0), miss.events.at(-1)]).toEqual(['', { t: 'missed', player: 0, target: 1, named: 'nope' }])
  })

  it('a triple must name a card other than a kitten; nothing else may name', () => {
    const s = table(['tacocat tacocat tacocat', 'skip'])
    const ids = s.players[0]!.hand.map((c) => c.id)
    const tryNaming = (named?: Kind, cards = ids) => check(s, { t: 'play', player: 0, cards, target: 1, named })
    expect([tryNaming(), tryNaming('exploding-kitten')]).toEqual(['name a card', 'name a card'])
    expect([tryNaming('tacocat'), tryNaming('skip', ids.slice(0, 2))]).toEqual([null, 'nothing to name'])
  })
})

describe('view and redaction', () => {
  it('shows each seat only the events it may know', () => {
    const c = card('skip')
    const drew = { t: 'drew', player: 0, card: c } satisfies Event
    const kitten = { ...drew, card: card('exploding-kitten') }
    const moved = { t: 'moved', from: 0, to: 1, card: c, via: 'favor' } satisfies Event
    const pair = { ...moved, via: 'pair' } satisfies Event
    const triple = { ...moved, via: 'triple' } satisfies Event
    const saw = { t: 'saw', player: 0, cards: [c] } satisfies Event
    const placed = { t: 'placed', player: 0, index: 2 } satisfies Event
    const defused = { t: 'defused', player: 0, card: card('defuse') } satisfies Event
    const cases: [Event, PlayerId, Event][] = [
      [drew, 0, drew],
      [drew, 1, { ...drew, card: null }],
      [kitten, 1, kitten],
      [moved, 0, moved],
      [moved, 1, moved],
      [moved, 2, { ...moved, card: null }],
      [pair, 2, { ...pair, card: null }],
      [triple, 2, triple],
      [saw, 0, saw],
      [saw, 1, { ...saw, cards: [] }],
      [placed, 0, placed],
      [placed, 1, { ...placed, index: null }],
      [defused, 1, defused],
    ]
    for (const [e, me, seen] of cases) expect(eventFor(e, me), `${e.t} for seat ${me}`).toEqual(seen)
  })
})

describe('determinism', () => {
  it('deals the same game for a seed, and a different one for each other seed', () => {
    expect(setup(4, 123)).toEqual(setup(4, 123))
    const decks = new Set(Array.from({ length: 200 }, (_, seed) => JSON.stringify(setup(4, seed).deck)))
    expect(decks.size).toBe(200)
  })
})

/** Every legal action right now: a generous superset, filtered by check. */
function legal(s: State): Action[] {
  const out: Action[] = s.phase.t === 'window' ? [{ t: 'expire', id: s.phase.id }] : []
  const n = Math.max(s.deck.length, ...s.players.map((p) => p.hand.length))
  for (const p of alive(s)) {
    const me = p.id
    out.push({ t: 'draw', player: me })
    for (let i = 0; i <= n; i++) out.push({ t: 'place', player: me, index: i }, { t: 'pick', player: me, index: i })
    for (const c of p.hand) {
      out.push(
        { t: 'nope', player: me, card: c.id, id: s.windows - 1 },
        { t: 'defuse', player: me, card: c.id },
        { t: 'give', player: me, card: c.id },
      )
      out.push({ t: 'play', player: me, cards: [c.id] })
      const same = p.hand.filter((x) => x.kind === c.kind).map((x) => x.id)
      for (const target of s.players.map((x) => x.id)) {
        out.push({ t: 'play', player: me, cards: [c.id], target })
        if (same.length >= 2) out.push({ t: 'play', player: me, cards: same.slice(0, 2), target })
        if (same.length >= 3) for (const named of Kinds) out.push({ t: 'play', player: me, cards: same.slice(0, 3), target, named })
      }
    }
  }
  return out.filter((a) => check(s, a) === null)
}

/** A random legal action, biased toward Nopes and plays so long Nope chains happen. */
function choose(s: State, rng: { rng: Rng }): Action {
  const options = legal(s)
  if (options.length === 0) throw new Error(`stuck in ${s.phase.t}`)
  const r = random(rng)
  const nopes = options.filter((a) => a.t === 'nope')
  const plays = options.filter((a) => a.t === 'play')
  const pool = nopes.length && r < 0.4 ? nopes : plays.length && r < 0.75 ? plays : options
  // Now and then someone runs out of time or leaves, so games still mostly end by kittens.
  const living = alive(s)
  if (random(rng) < 0.02) return { t: 'out', player: living[Math.floor(random(rng) * living.length)]!.id, why: 'time' }
  return pool[Math.floor(random(rng) * pool.length)]!
}

const Junk = [-1, 0.5, NaN]

/** A well-typed action with random, mostly wrong, fields. */
function junk(s: State, rng: { rng: Rng }): Action {
  const any = <T>(xs: readonly T[]): T => xs[Math.floor(random(rng) * xs.length)]!
  const players = [...s.players.map((p) => p.id), s.players.length, ...Junk]
  const ids = [...cardIds(s), ...Junk]
  const player = any(players)
  const card = any(ids)
  const index = any([0, 1, s.deck.length, s.deck.length + 1, ...Junk])
  return any<Action>([
    {
      t: 'play',
      player,
      cards: [card, any(ids), any(ids)].slice(0, any([0, 1, 2, 3])),
      target: any([...players, undefined]),
      named: any([...Kinds, undefined]),
    },
    { t: 'nope', player, card, id: any([s.windows - 1, s.windows, ...Junk]) },
    { t: 'expire', id: any([s.windows - 1, s.windows, ...Junk]) },
    { t: 'draw', player },
    { t: 'defuse', player, card },
    { t: 'place', player, index },
    { t: 'give', player, card },
    { t: 'pick', player, index },
    { t: 'out', player, why: 'left' },
  ])
}

function cardIds(s: State): number[] {
  const ph = s.phase
  return [
    ...s.deck,
    ...s.discard,
    ...s.box,
    ...s.players.flatMap((p) => [...p.hand, ...(p.kitten ? [p.kitten] : [])]),
    ...(ph.t === 'window' ? [...ph.pending.cards, ...ph.nopes.map((n) => n.card)] : []),
    ...(ph.t === 'kitten' || ph.t === 'place' ? [ph.card] : []),
  ]
    .map((c) => c.id)
    .sort((a, b) => a - b)
}

/** The rules every state keeps. Plain checks, not expect: the fuzz runs them tens of thousands of times. */
function invariants(s: State, ids: number[]) {
  const rule = (holds: boolean, what: string) => {
    if (!holds) throw new Error(`Broken: ${what}`)
  }
  const living = alive(s)
  const held = s.phase.t === 'kitten' || s.phase.t === 'place' ? 1 : 0
  rule(String(cardIds(s)) === String(ids), 'no card is created, lost or duplicated')
  rule(s.deck.filter((c) => c.kind === 'exploding-kitten').length + held === living.length - 1, 'one kitten fewer than players alive')
  rule(!s.players.some((p) => p.hand.some((c) => c.kind === 'exploding-kitten')), 'no kitten in a hand')
  rule(s.turns === 1 || s.attacked, 'more than one turn owed only under an Attack')
  for (const p of s.players)
    rule(
      p.alive ? p.kitten === null : p.hand.length === 0 && (p.kitten?.kind ?? 'exploding-kitten') === 'exploding-kitten',
      'the out hold no card but a kitten',
    )
  if (s.phase.t === 'over') rule(living.length === 1 && living[0]!.id === s.phase.winner, 'the last alive wins')
  else {
    const w = waitingOn(s)
    rule(living.length > 1 && s.players[s.current]!.alive && s.turns >= 1, 'someone alive is on turn, owing a turn')
    rule(w === null || s.players[w]!.alive, 'only the living are waited on')
  }
}

const cardsIn = (v: unknown, out: Card[] = []): Card[] => {
  if (Array.isArray(v)) v.forEach((x) => cardsIn(x, out))
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.id === 'number' && typeof o.kind === 'string') out.push(o as unknown as Card)
    else Object.values(o).forEach((x) => cardsIn(x, out))
  }
  return out
}

/** A seat's view, or a watcher's (null), holds no card from the deck, the box or another seat's hand. */
function secret(s: State, me: PlayerId | null) {
  const v = view(s, me)
  const hidden = new Set([...s.deck, ...s.box, ...s.players.filter((o) => o.id !== me).flatMap((o) => o.hand)].map((c) => c.id))
  expect(cardsIn(v).filter((c) => hidden.has(c.id))).toEqual([])
  expect([v.hand, v.deck, v.kittens]).toEqual([
    me === null ? [] : s.players[me]!.hand,
    s.deck.length,
    s.deck.filter((c) => c.kind === 'exploding-kitten').length,
  ])
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

describe('fuzz', () => {
  it('random games, with junk at every step, keep every invariant and secret, survive a save, and always end', () => {
    const rng = { rng: seeded(31337) }
    const phasesSeen = new Set<string>()
    const eventsSeen = new Set<string>()
    let longest = 0
    for (let g = 0; g < 40; g++) {
      let s = setup(2 + (g % 4), 5000 + g)
      const ids = cardIds(s)
      expect(new Set(ids).size).toBe(ids.length)
      let lastWindow = -1
      const deep = g % 4 === 0 // the slower checks, on every 4th game
      for (let step = 0; s.phase.t !== 'over'; step++) {
        if (step > 5000) throw new Error(`game ${g} did not end`)
        deepFreeze(s) // so any mutation of the input throws
        for (let k = 0; k < 3; k++) {
          const a = junk(s, rng)
          if (check(s, a) === null) invariants(apply(s, a).state, ids)
        }
        if (deep) for (const me of [...s.players.map((p) => p.id), null]) secret(s, me)
        const a = choose(s, rng)
        const next = apply(s, a)
        // A save picks up exactly where it was.
        if (deep) expect(apply(JSON.parse(JSON.stringify(s)) as State, a)).toEqual(next)
        for (const e of next.events) eventsSeen.add(e.t)
        s = next.state
        if (s.phase.t === 'window' && s.phase.id !== lastWindow) {
          expect(s.phase.id).toBeGreaterThan(lastWindow)
          lastWindow = s.phase.id
        }
        phasesSeen.add(s.phase.t)
        if (s.phase.t === 'window') longest = Math.max(longest, s.phase.nopes.length)
        invariants(s, ids)
      }
    }
    // A fuzz that misses a phase, an event or long Nope chains proves little.
    expect(phasesSeen).toEqual(new Set(['turn', 'window', 'favor', 'steal', 'kitten', 'place', 'over']))
    expect(eventsSeen).toEqual(
      new Set(['played', 'noped', 'resolved', 'drew', 'defused', 'placed', 'exploded', 'out', 'moved', 'missed', 'saw', 'shuffled']),
    )
    expect(longest).toBeGreaterThanOrEqual(3)
  }, 60_000)
})
