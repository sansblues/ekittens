import { describe, expect, it } from 'vitest'
import { act, react, remember, type Memory } from './bot'
import {
  apply,
  eventFor,
  random,
  seeded,
  setup,
  shuffle,
  view,
  waitingOn,
  type Action,
  type Card,
  type Event,
  type Kind,
  type Pending,
  type Phase,
  type PlayerId,
  type State,
  type View,
} from './engine'

type Brain = 'bot' | 'naive'

function simulate(brains: Brain[], seed: number) {
  let s: State = setup(brains.length, seed)
  const rng = { rng: seeded(seed * 7919) }
  const rand = () => random(rng)
  const memory: Memory[] = brains.map(() => [])

  // `apply` throws on an illegal move.
  const step = (a: Action) => {
    const r = apply(s, a)
    s = r.state
    for (const e of r.events) for (const p of s.players) memory[p.id] = remember(memory[p.id]!, eventFor(e, p.id), p.id)
    // What a bot remembers of the deck's top is always true: a wrong memory leaves a bot legal, but blind.
    for (const m of memory) expect(m).toEqual(s.deck.slice(0, m.length).map((c) => c.kind))
  }

  for (let steps = 0; s.phase.t !== 'over'; steps++) {
    if (steps > 5000) throw new Error('game did not end')
    const ph = s.phase
    if (ph.t === 'window') {
      const order = shuffle(
        rng,
        s.players.filter((p) => p.alive && brains[p.id] === 'bot').map((p) => p.id),
      )
      const nope = order.map((id) => react(view(s, id), rand)).find(Boolean)
      step(nope ?? { t: 'expire', id: ph.id })
      continue
    }
    const who = waitingOn(s)!
    step(brains[who] === 'bot' ? act(view(s, who), memory[who]!, rand) : naive(s, who))
  }
  return s.phase.winner
}

function naive(s: State, me: PlayerId): Action {
  const ph = s.phase
  const hand = s.players[me]!.hand
  if (ph.t === 'kitten') return { t: 'defuse', player: me, card: hand.find((c) => c.kind === 'defuse')!.id }
  if (ph.t === 'place') return { t: 'place', player: me, index: Math.floor(s.deck.length / 2) }
  if (ph.t === 'favor') return { t: 'give', player: me, card: hand[0]!.id }
  if (ph.t === 'steal') return { t: 'pick', player: me, index: 0 }
  return { t: 'draw', player: me }
}

/** Seat 0's view of a three-player table; its danger (2 kittens in 20) prompts no Peek or dodge. */
function seat(hand: string, rest: Partial<View<PlayerId>> = {}): View<PlayerId> {
  return {
    me: 0,
    hand: hand.split(' ').map((kind, id): Card => ({ id, kind: kind as Kind })),
    players: [0, 1, 2].map((id) => ({ id, alive: true, cards: 3, kitten: null })),
    deck: 20,
    kittens: 2,
    discard: [],
    current: 0,
    turns: 1,
    attacked: false,
    phase: { t: 'turn' },
    ...rest,
  }
}

/** A Nope window over seat 1's play. */
const nopeWindow = (pending: Partial<Pending>): Phase => ({
  t: 'window',
  id: 7,
  pending: { player: 1, cards: [], effect: 'skip', target: null, named: null, ...pending },
  nopes: [],
})

const never = () => 0.99
const always = () => 0

describe('bot', () => {
  it('only ever makes legal moves, across many full games of every size', () => {
    for (let g = 0; g < 40; g++) simulate(Array<Brain>(2 + (g % 4)).fill('bot'), g)
  })

  it('beats a naive drawer clearly', () => {
    let wins = 0
    const games = 200
    for (let g = 0; g < games; g++) {
      const botSeat = g % 2
      if (simulate(botSeat === 0 ? ['bot', 'naive'] : ['naive', 'bot'], 10_000 + g) === botSeat) wins++
    }
    expect(wins / games).toBeGreaterThan(0.75)
  })

  it("remembers See the Future and its own placements; forgets on a shuffle, anyone else's placement, or a kitten it knew leaving", () => {
    const cards: Card[] = [
      { id: 1, kind: 'exploding-kitten' },
      { id: 2, kind: 'skip' },
    ]
    let m = remember([], { t: 'saw', player: 0, cards }, 0)
    expect(m).toEqual(['exploding-kitten', 'skip'])
    expect(remember([], { t: 'saw', player: 1, cards }, 0)).toEqual([]) // not ours
    m = remember(m, { t: 'drew', player: 1, card: null }, 0)
    expect(m).toEqual(['skip'])
    expect(remember(m, { t: 'shuffled' }, 0)).toEqual([])
    expect(remember(m, { t: 'placed', player: 1, index: 0 }, 0)).toEqual([])
    expect(remember(m, { t: 'placed', player: 0, index: 0 }, 0)).toEqual(['exploding-kitten', 'skip'])
    expect(remember(m, { t: 'placed', player: 0, index: 1 }, 0)).toEqual(['skip', 'exploding-kitten'])
    expect(remember(m, { t: 'placed', player: 0, index: 2 }, 0)).toEqual(['skip']) // below what we know
    // Someone goes out and the deck's lowest kitten leaves: it may be one we know of.
    const out: Event = { t: 'out', player: 1, why: 'time', hand: [], kitten: null }
    expect([remember(m, out, 0), remember(['exploding-kitten', 'skip'], out, 0)]).toEqual([['skip'], []])
  })

  it('gets away from a kitten it knows is on top, or tries a card that might', () => {
    expect(act(seat('skip tacocat'), ['exploding-kitten'], never)).toMatchObject({ t: 'play', cards: [0] })
    expect(act(seat('favor'), ['exploding-kitten'], never)).toMatchObject({ t: 'play', cards: [0], target: 1 })
    expect(act(seat('tacocat'), ['exploding-kitten'], never)).toEqual({ t: 'draw', player: 0 })
  })

  it('buries the kitten while it still owes turns', () => {
    const place = (turns: number, rand: () => number) =>
      act(
        seat('skip', {
          turns,
          deck: 10,
          phase: { t: 'place', card: { id: 9, kind: 'exploding-kitten' }, defuse: { id: 8, kind: 'defuse' } },
        }),
        [],
        rand,
      )
    expect(place(2, always)).toEqual({ t: 'place', player: 0, index: 10 })
    expect(place(1, always)).toEqual({ t: 'place', player: 0, index: 0 })
  })

  it('gives away a lone cat first', () => {
    const give = act(seat('defuse tacocat tacocat beard-cat shuffle', { phase: { t: 'favor', from: 0, to: 1 } }), [], never)
    expect(give).toEqual({ t: 'give', player: 0, card: 3 })
  })

  it('never Nopes itself, and spares a Nope for a triple that would miss, or a Favor that would take only a lone cat', () => {
    const v = (phase: Phase) => seat('nope skip', { phase })
    expect(react(v(nopeWindow({ player: 0 })), always)).toBeNull()
    expect(react(v(nopeWindow({ effect: 'favor', target: 0 })), always)).toMatchObject({ t: 'nope', id: 7 })
    expect(react(v(nopeWindow({ effect: 'triple', target: 0, named: 'defuse' })), always)).toBeNull()
    expect(react(v(nopeWindow({ effect: 'triple', target: 0, named: 'skip' })), always)).toMatchObject({ t: 'nope' })
    expect(react(v(nopeWindow({ effect: 'favor', target: 2 })), always)).toBeNull() // not aimed at us
    expect(react(seat('nope tacocat', { phase: nopeWindow({ effect: 'favor', target: 0 }) }), always)).toBeNull()
  })
})
