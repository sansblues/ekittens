import { found, isCat, lastIn, noped, targetOf, type Action, type Card, type Event, type Kind, type PlayerId, type View } from './engine'

// It sees only its seat's View and what it remembers, so it can never cheat.

/** The known top of the deck, top first. Empty when unknown. */
export type Memory = Kind[]

export function remember(top: Memory, e: Event, me: PlayerId): Memory {
  switch (e.t) {
    case 'saw':
      return e.player === me ? e.cards.map((c) => c.kind) : top
    case 'drew':
      return top.slice(1)
    case 'shuffled':
      return []
    case 'out':
      // A kitten left the deck from its bottom: below what we know, unless what we know holds one.
      return e.kitten || !top.includes('exploding-kitten') ? top : []
    case 'placed':
      // Someone else hid a kitten somewhere unknown; our own, below what we know, changes nothing.
      if (e.player !== me) return []
      return e.index! <= top.length ? top.toSpliced(e.index!, 0, 'exploding-kitten') : top
    default:
      return top
  }
}

const find = (hand: Card[], kind: Kind) => hand.find((c) => c.kind === kind)

/** Only when the game waits on the bot: never during a Nope window, nor once it's over. */
export function act(v: View<PlayerId>, top: Memory, rand: () => number): Action {
  const me = v.me
  const ph = v.phase
  switch (ph.t) {
    case 'kitten':
      return { t: 'defuse', player: me, card: find(v.hand, 'defuse')!.id }
    case 'place': {
      const n = v.deck
      // Still owing turns after this one? Bury it, or we'd draw it ourselves.
      if (v.turns > 1) return { t: 'place', player: me, index: n - Math.floor(rand() * Math.ceil(n / 2)) }
      // Otherwise mostly on top, for the next player to draw.
      const r = rand()
      return { t: 'place', player: me, index: r < 0.5 ? 0 : r < 0.75 ? Math.min(1, n) : Math.floor(rand() * (n + 1)) }
    }
    case 'favor':
      return { t: 'give', player: me, card: cheapest(v.hand).id }
    case 'steal':
      return { t: 'pick', player: me, index: Math.floor(rand() * v.players[ph.victim]!.cards) }
    case 'turn':
      return turn(v, top, rand)
    case 'window':
    case 'over':
      throw new Error(`nothing to do in a ${ph.t}`)
  }
}

function turn(v: View<PlayerId>, top: Memory, rand: () => number): Action {
  const me = v.me
  const play = (cards: Card[], extra: { target?: PlayerId; named?: Kind } = {}): Action => ({
    t: 'play',
    player: me,
    cards: cards.map((c) => c.id),
    ...extra,
  })
  const draw: Action = { t: 'draw', player: me }
  const escape = find(v.hand, 'attack') ?? find(v.hand, 'skip')
  const hasDefuse = !!find(v.hand, 'defuse')
  const danger = v.kittens / v.deck

  // A kitten we know is on top: away from it, or else anything a steal might bring.
  const doomed = top[0] === 'exploding-kitten'
  if (doomed) {
    const out = escape ?? find(v.hand, 'shuffle')
    if (out) return play([out])
  }

  const victim = v.players.filter((p) => p.alive && p.id !== me && p.cards > 0).sort((a, b) => b.cards - a.cards)[0]?.id
  if (victim !== undefined) {
    const cats = v.hand.filter((c) => isCat(c.kind)).map((c) => v.hand.filter((x) => x.kind === c.kind))
    const triple = cats.find((g) => g.length >= 3)
    if (triple) return play(triple.slice(0, 3), { target: victim, named: hasDefuse ? 'nope' : 'defuse' })
    const pair = cats.find((g) => g.length === 2)
    if (pair && (doomed || !hasDefuse || rand() < 0.5)) return play(pair, { target: victim })
    const favor = find(v.hand, 'favor')
    if (favor && (doomed || rand() < 0.5)) return play([favor], { target: victim })
  }

  // A known top is safe, or past saving.
  if (top.length > 0) return draw

  const future = find(v.hand, 'see-the-future')
  if (future && danger >= 0.2) return play([future])
  if (escape && (danger >= 0.35 || (!hasDefuse && danger > 0.1))) return play([escape])
  return draw
}

/** During a Nope window: a Nope, or null to let it be. */
export function react(v: View<PlayerId>, rand: () => number): Action | null {
  const ph = v.phase
  if (ph.t !== 'window') return null
  const nope = find(v.hand, 'nope')
  if (!nope || lastIn(ph) === v.me) return null // never Nope ourselves
  const nopeIt: Action = { t: 'nope', player: v.me, card: nope.id, id: ph.id }

  if (noped(ph)) return ph.pending.player === v.me && rand() < 0.6 ? nopeIt : null

  // A play that would find nothing to take from us misses anyway.
  const { effect, named } = ph.pending
  if (targetOf(v) !== v.me || (effect !== 'attack' && !found(v.hand, named))) return null
  // A Favor takes only the card we pick: worth a Nope only when even our cheapest is worth keeping.
  if (effect === 'favor' && worth(cheapest(v.hand), v.hand) < 3) return null
  return rand() < (effect === 'attack' ? 0.75 : 0.5) ? nopeIt : null
}

const Value: Partial<Record<Kind, number>> = { defuse: 9, nope: 7, attack: 6, skip: 5, favor: 5, 'see-the-future': 4, shuffle: 3 }

/** The card we'd miss least: a lone cat, then a paired one, then the weakest action. */
function cheapest(hand: Card[]): Card {
  return hand.toSorted((a, b) => worth(a, hand) - worth(b, hand))[0]!
}

/** How much we'd miss `c`: a lone cat least, then a paired one, then each action by its `Value`. */
const worth = (c: Card, hand: Card[]) => Value[c.kind] ?? (hand.filter((x) => x.kind === c.kind).length === 1 ? 0 : 1)
