// The rules of Exploding Kittens, pure: every move is a new state and the events it caused.

/** Copies of each kind in the base deck (56 cards). Hands sort in this order. */
export const Counts = {
  'exploding-kitten': 4,
  defuse: 6,
  nope: 5,
  attack: 4,
  skip: 4,
  favor: 4,
  shuffle: 4,
  'see-the-future': 5,
  tacocat: 4,
  cattermelon: 4,
  'hairy-potato-cat': 4,
  'beard-cat': 4,
  'rainbow-ralphing-cat': 4,
} as const

export type Kind = keyof typeof Counts

export const Kinds = Object.keys(Counts) as Kind[]

/** The kinds a triple may name. */
export const Nameable: readonly Kind[] = Kinds.filter((k) => k !== 'exploding-kitten')

export interface Card {
  id: number
  kind: Kind
}

const Cats: readonly Kind[] = ['tacocat', 'cattermelon', 'hairy-potato-cat', 'beard-cat', 'rainbow-ralphing-cat']

export const isCat = (kind: Kind) => Cats.includes(kind)

/** The cards played on their own, on your turn. */
const Singles = ['attack', 'skip', 'favor', 'shuffle', 'see-the-future'] as const

type Single = (typeof Singles)[number]

const isSingle = (kind: Kind): kind is Single => (Singles as readonly Kind[]).includes(kind)

type Effect = Single | 'pair' | 'triple'

/** The plays that ask another player for a card. */
type Asking = 'favor' | 'pair' | 'triple'

export type PlayerId = number

interface Player {
  id: PlayerId
  hand: Card[]
  alive: boolean
  /** The kitten that went off in this player's hands. It stays with them, in view. */
  kitten: Card | null
}

/** Why someone went out of the game without drawing a kitten. */
type Why = 'time' | 'left'

/** A play waiting out its Nope window. */
export interface Pending {
  player: PlayerId
  cards: Card[]
  effect: Effect
  target: PlayerId | null
  named: Kind | null
}

export type Phase =
  | { t: 'turn' }
  /** A play is announced; anyone may Nope until the window expires. */
  | { t: 'window'; id: number; pending: Pending; nopes: { player: PlayerId; card: Card }[] }
  /** `from` must give `to` a card of their choice. */
  | { t: 'favor'; from: PlayerId; to: PlayerId }
  /** `thief` picks a blind card from `victim`'s (shuffled) hand. */
  | { t: 'steal'; thief: PlayerId; victim: PlayerId }
  /** The current player drew a kitten and holds a Defuse. */
  | { t: 'kitten'; card: Card }
  /** The current player defused and must put the kitten back; `defuse` is the card they defused it with. */
  | { t: 'place'; card: Card; defuse: Card }
  | { t: 'over'; winner: PlayerId }

export interface State {
  players: Player[]
  /** Index 0 is the top. */
  deck: Card[]
  /** Last element is the top. */
  discard: Card[]
  current: PlayerId
  /** Turns the current player still owes, including this one. */
  turns: number
  /** Whether the current player's turns come from an Attack (makes Attacks stack). */
  attacked: boolean
  phase: Phase
  /** Nope windows opened so far; also the next window's id. */
  windows: number
  rng: Rng
  /** Back in the game box, out of play: the kitten that leaves the deck with each player who goes out holding none.
   *  Nobody sees it again, or where it came from would tell whoever hid a kitten whether it was theirs. */
  box: Card[]
}

export type Action =
  | { t: 'play'; player: PlayerId; cards: number[]; target?: PlayerId; named?: Kind }
  | { t: 'nope'; player: PlayerId; card: number; id: number }
  | { t: 'expire'; id: number }
  | { t: 'draw'; player: PlayerId }
  | { t: 'defuse'; player: PlayerId; card: number }
  | { t: 'place'; player: PlayerId; index: number }
  | { t: 'give'; player: PlayerId; card: number }
  | { t: 'pick'; player: PlayerId; index: number }
  /** Out of the game: the clock ran out, or they left. Allowed any time before the end. */
  | { t: 'out'; player: PlayerId; why: Why }

// Each event says all its line in the log needs, so the log can be told from the events alone.
export type Event =
  /** `at`: whom the play is aimed at; for an Attack, the next player. */
  | { t: 'played'; pending: Pending; at: PlayerId | null }
  /** `stops`: whose play or Nope this stops, and its cards. */
  | { t: 'noped'; player: PlayerId; card: Card; stops: { player: PlayerId; cards: Card[] } }
  | { t: 'resolved'; pending: Pending; noped: boolean }
  /** `card` is null when redacted for someone who can't see it. */
  | { t: 'drew'; player: PlayerId; card: Card | null }
  | { t: 'defused'; player: PlayerId; card: Card }
  | { t: 'placed'; player: PlayerId; index: number | null }
  /** `hand`: what they held, now on the discard pile. */
  | { t: 'exploded'; player: PlayerId; hand: Card[] }
  /** `kitten`: the one that went off in their hands; null when the deck's lowest went in the box instead. */
  | { t: 'out'; player: PlayerId; why: Why; hand: Card[]; kitten: Card | null }
  /** `via`: the play that asked for it. A card a triple named is public. */
  | { t: 'moved'; from: PlayerId; to: PlayerId; card: Card | null; via: Asking }
  /** A Favor, pair or triple that took nothing. */
  | { t: 'missed'; player: PlayerId; target: PlayerId; named: Kind | null }
  | { t: 'saw'; player: PlayerId; cards: Card[] }
  | { t: 'shuffled' }

/** A seeded generator's state (sfc32): 128 bits, so no hand dealt from it gives the rest of the deck away. It
 *  lives in game state, so games are reproducible and resumable. */
export type Rng = [number, number, number, number]

/** A generator's state from one number (splitmix32), for tests and for games seeded by hand. */
export function seeded(n: number): Rng {
  const next = () => {
    n = (n + 0x9e3779b9) | 0
    let z = n
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
    return (z ^ (z >>> 15)) >>> 0
  }
  return [next(), next(), next(), next()]
}

export function random(state: { rng: Rng }): number {
  let [a, b, c, d] = state.rng
  const t = (((a + b) | 0) + d) | 0
  d = (d + 1) | 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) | 0
  c = (c << 21) | (c >>> 11)
  c = (c + t) | 0
  state.rng = [a, b, c, d]
  return (t >>> 0) / 4294967296
}

/** Fisher–Yates, in place. */
export function shuffle<T>(state: { rng: Rng }, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}

export function setup(players: number, seed: number | Rng): State {
  // The deck has kittens for at most 5 (one fewer than the players), and a game needs two.
  if (players < 2 || players > 5) throw new Error(`setup: 2 to 5 players, not ${players}`)
  const rng = { rng: typeof seed === 'number' ? seeded(seed) : seed }
  // Numbered after shuffling, so an id never gives its kind away.
  const all = shuffle(
    rng,
    Kinds.flatMap((kind) => Array<Kind>(Counts[kind]).fill(kind)),
  ).map((kind, id): Card => ({ id, kind }))
  const kittens = all.filter((c) => c.kind === 'exploding-kitten')
  // Shuffled again before dealing, so the ids in a hand aren't a run, and a Defuse's id never says whether
  // it was dealt or came from the deck.
  const defuses = shuffle(
    rng,
    all.filter((c) => c.kind === 'defuse'),
  )
  const deck = shuffle(
    rng,
    all.filter((c) => c.kind !== 'exploding-kitten' && c.kind !== 'defuse'),
  )
  const table = Array.from({ length: players }, (_, i): Player => ({
    id: i,
    hand: [...deck.splice(0, 7), defuses[i]!],
    alive: true,
    kitten: null,
  }))
  // The spare Defuses go back in: all of them, but only 2 in a 2-player game.
  deck.push(...defuses.slice(players, players === 2 ? 4 : undefined), ...kittens.slice(0, players - 1))
  shuffle(rng, deck)
  return {
    players: table,
    deck,
    discard: [],
    current: 0,
    turns: 1,
    attacked: false,
    phase: { t: 'turn' },
    windows: 0,
    rng: rng.rng,
    box: [],
  }
}

export const alive = (s: State) => s.players.filter((p) => p.alive)

function nextAlive(s: { players: { alive: boolean }[] }, from: PlayerId): PlayerId {
  const n = s.players.length
  let id = (from + 1) % n
  while (!s.players[id]!.alive) id = (id + 1) % n
  return id
}

const targets = (s: State, player: PlayerId): PlayerId[] =>
  s.players.filter((p) => p.alive && p.id !== player && p.hand.length > 0).map((p) => p.id)

/** Who the play in a Nope window is aimed at; an Attack, at the next player. Takes a View too. */
export function targetOf(s: { players: { alive: boolean }[]; phase: Phase }): PlayerId | null {
  if (s.phase.t !== 'window') return null
  const { pending } = s.phase
  return pending.target ?? (pending.effect === 'attack' ? nextAlive(s, pending.player) : null)
}

/** A card a Favor, pair or triple can take from `hand`, if any: of the named kind for a triple, else any. */
export const found = (hand: Card[], named: Kind | null) => (named ? hand.find((c) => c.kind === named) : hand[0])

export const noped = (w: { nopes: unknown[] }) => w.nopes.length % 2 === 1

/** Who acted last in a Nope window. */
export const lastIn = (w: { pending: Pending; nopes: { player: PlayerId }[] }) => w.nopes.at(-1)?.player ?? w.pending.player

export const attackTurns = (s: { turns: number; attacked: boolean }) => (s.attacked ? s.turns : 0) + 2

/** Null during a Nope window, where anyone may act, and once the game is over. Takes a View too. */
export function waitingOn(s: { phase: Phase; current: PlayerId }): PlayerId | null {
  switch (s.phase.t) {
    case 'turn':
    case 'kitten':
    case 'place':
      return s.current
    case 'favor':
      return s.phase.from
    case 'steal':
      return s.phase.thief
    case 'window':
    case 'over':
      return null
  }
}

/** What one seat can see: its own hand and public information only. `me` is null for someone watching without a seat.
 *  Other hands and the deck are counts, never cards: even a card's id would tell where a hidden kitten lies. */
export interface View<Me extends PlayerId | null = PlayerId | null> {
  me: Me
  hand: Card[]
  players: { id: PlayerId; alive: boolean; cards: number; kitten: Card | null }[]
  deck: number
  /** Kittens left in the deck (public: always players alive − 1, minus one being defused). */
  kittens: number
  discard: Card[]
  current: PlayerId
  turns: number
  attacked: boolean
  phase: Phase
}

export function view<Me extends PlayerId | null>(s: State, me: Me): View<Me> {
  const held = s.phase.t === 'kitten' || s.phase.t === 'place' ? 1 : 0
  return structuredClone({
    me,
    hand: me === null ? [] : s.players[me]!.hand,
    players: s.players.map((p) => ({ id: p.id, alive: p.alive, cards: p.hand.length, kitten: p.kitten })),
    deck: s.deck.length,
    kittens: alive(s).length - 1 - held,
    discard: s.discard,
    current: s.current,
    turns: s.turns,
    attacked: s.attacked,
    phase: s.phase,
  })
}

/** What `me` may learn from an event: other players' secrets are redacted. */
export function eventFor(e: Event, me: PlayerId | null): Event {
  switch (e.t) {
    case 'drew':
      return e.player === me || e.card?.kind === 'exploding-kitten' ? e : { ...e, card: null }
    case 'moved':
      return e.from === me || e.to === me || e.via === 'triple' ? e : { ...e, card: null }
    case 'saw':
      return e.player === me ? e : { ...e, cards: [] }
    case 'placed':
      return e.player === me ? e : { ...e, index: null }
    default:
      return e
  }
}

/** Why `a` is illegal, or null if it's legal. */
export function check(s: State, a: Action): string | null {
  const ph = s.phase
  if (a.t === 'expire') return ph.t === 'window' && ph.id === a.id ? null : 'no such window'
  const p = s.players[a.player]
  if (!p) return 'no such player'
  if (a.t === 'out') return ph.t === 'over' ? 'game over' : p.alive ? null : 'already out'
  // Game over and the dead need no check: every move needs its phase, and the dead never have the move or a card.
  const has = (id: number) => p.hand.find((c) => c.id === id)

  switch (a.t) {
    case 'play': {
      if (ph.t !== 'turn') return 'not now'
      if (a.player !== s.current) return 'not your turn'
      if (new Set(a.cards).size !== a.cards.length) return 'duplicate cards'
      const cards = a.cards.map(has)
      if (cards.length === 0 || cards.some((c) => !c)) return 'card not in hand'
      const kind = cards[0]!.kind
      if (cards.some((c) => c!.kind !== kind)) return 'cards must match'
      const effect = effectOf(kind, cards.length)
      if (!effect) return 'not playable'
      if (effect === 'favor' || isCat(kind)) {
        if (a.target === undefined || !targets(s, a.player).includes(a.target)) return 'invalid target'
      } else if (a.target !== undefined) return 'no target needed'
      if (effect === 'triple') {
        if (!a.named || !Nameable.includes(a.named)) return 'name a card'
      } else if (a.named !== undefined) return 'nothing to name'
      return null
    }
    case 'nope':
      if (ph.t !== 'window') return 'nothing to nope'
      if (ph.id !== a.id) return 'no such window'
      return has(a.card)?.kind === 'nope' ? null : 'no such nope'
    case 'draw':
      if (ph.t !== 'turn') return 'not now'
      return a.player === s.current ? null : 'not your turn'
    case 'defuse':
      if (ph.t !== 'kitten') return 'nothing to defuse'
      if (a.player !== s.current) return 'not your kitten'
      return has(a.card)?.kind === 'defuse' ? null : 'no such defuse'
    case 'place':
      if (ph.t !== 'place') return 'nothing to place'
      if (a.player !== s.current) return 'not your kitten'
      return Number.isInteger(a.index) && a.index >= 0 && a.index <= s.deck.length ? null : 'invalid position'
    case 'give':
      if (ph.t !== 'favor') return 'no favor asked'
      if (a.player !== ph.from) return 'not asked'
      return has(a.card) ? null : 'card not in hand'
    case 'pick': {
      if (ph.t !== 'steal') return 'nothing to steal'
      if (a.player !== ph.thief) return 'not your steal'
      const n = s.players[ph.victim]!.hand.length
      return Number.isInteger(a.index) && a.index >= 0 && a.index < n ? null : 'invalid pick'
    }
  }
}

function effectOf(kind: Kind, count: number): Effect | null {
  if (isCat(kind)) return count === 2 ? 'pair' : count === 3 ? 'triple' : null
  return count === 1 && isSingle(kind) ? kind : null
}

export function apply(state: State, action: Action): { state: State; events: Event[] } {
  const reason = check(state, action)
  if (reason) throw new Error(`${action.t}: ${reason}`)

  const s = structuredClone(state)
  const events: Event[] = []
  const ph = s.phase

  // Each `ph.t` test below always passes after `check`: it narrows the phase's type.
  switch (action.t) {
    case 'play': {
      const p = s.players[action.player]!
      const cards = action.cards.map((id) => take(p, id))
      const pending: Pending = {
        player: p.id,
        cards,
        effect: effectOf(cards[0]!.kind, cards.length)!,
        target: action.target ?? null,
        named: action.named ?? null,
      }
      s.phase = { t: 'window', id: s.windows++, pending, nopes: [] }
      events.push({ t: 'played', pending, at: targetOf(s) })
      break
    }
    case 'nope': {
      if (ph.t !== 'window') break
      const card = take(s.players[action.player]!, action.card)
      const last = ph.nopes.at(-1)
      const stops = last ? { player: last.player, cards: [last.card] } : { player: ph.pending.player, cards: ph.pending.cards }
      ph.nopes.push({ player: action.player, card })
      // A new id: the old window's expiry, and any Nope still meant for it, no longer apply.
      ph.id = s.windows++
      events.push({ t: 'noped', player: action.player, card, stops })
      break
    }
    case 'expire': {
      if (ph.t !== 'window') break
      const stopped = noped(ph)
      s.discard.push(...ph.pending.cards, ...ph.nopes.map((n) => n.card))
      s.phase = { t: 'turn' }
      events.push({ t: 'resolved', pending: ph.pending, noped: stopped })
      if (!stopped) resolve(s, ph.pending, events)
      break
    }
    case 'draw': {
      const p = s.players[action.player]!
      const card = s.deck.shift()!
      events.push({ t: 'drew', player: p.id, card })
      if (card.kind !== 'exploding-kitten') {
        p.hand.push(card)
        endTurn(s)
      } else if (p.hand.some((c) => c.kind === 'defuse')) s.phase = { t: 'kitten', card }
      else explode(s, p, card, events)
      break
    }
    case 'defuse': {
      if (ph.t !== 'kitten') break
      const card = take(s.players[action.player]!, action.card)
      s.discard.push(card)
      s.phase = { t: 'place', card: ph.card, defuse: card }
      events.push({ t: 'defused', player: action.player, card })
      break
    }
    case 'place': {
      if (ph.t !== 'place') break
      s.deck.splice(action.index, 0, ph.card)
      // Everyone saw this kitten's id as it was drawn: it trades ids with any kitten in the deck (itself, maybe), so
      // the id of one drawn later never tells whether it's this one.
      const kittens = s.deck.filter((c) => c.kind === 'exploding-kitten')
      const other = kittens[Math.floor(random(s) * kittens.length)]!
      ;[ph.card.id, other.id] = [other.id, ph.card.id]
      events.push({ t: 'placed', player: action.player, index: action.index })
      endTurn(s)
      break
    }
    case 'give': {
      if (ph.t !== 'favor') break
      s.phase = { t: 'turn' }
      move(s, ph.from, ph.to, action.card, 'favor', events)
      break
    }
    case 'pick': {
      if (ph.t !== 'steal') break
      s.phase = { t: 'turn' }
      move(s, ph.victim, ph.thief, s.players[ph.victim]!.hand[action.index]!.id, 'pair', events)
      break
    }
    case 'out':
      goOut(s, s.players[action.player]!, action.why, events)
      break
  }
  // Events must not alias the new state.
  return { state: s, events: structuredClone(events) }
}

function resolve(s: State, pending: Pending, events: Event[]) {
  const { player, effect, target, named } = pending
  switch (effect) {
    case 'attack': {
      const turns = attackTurns(s)
      s.current = nextAlive(s, s.current)
      s.turns = turns
      s.attacked = true
      return
    }
    case 'skip':
      return endTurn(s)
    case 'shuffle':
      shuffle(s, s.deck)
      events.push({ t: 'shuffled' })
      return
    case 'see-the-future':
      events.push({ t: 'saw', player, cards: s.deck.slice(0, 3) })
      return
  }
  // A Favor, pair or triple asks its target for a card; they may have spent their last on a Nope.
  const victim = s.players[target!]!
  const card = found(victim.hand, named)
  if (!card) events.push({ t: 'missed', player, target: victim.id, named })
  else if (effect === 'triple') move(s, victim.id, player, card.id, 'triple', events)
  else if (effect === 'favor') s.phase = { t: 'favor', from: victim.id, to: player }
  else {
    shuffle(s, victim.hand) // a blind pick must not depend on hand order
    s.phase = { t: 'steal', thief: player, victim: victim.id }
  }
}

const take = (p: Player, id: number) =>
  p.hand.splice(
    p.hand.findIndex((c) => c.id === id),
    1,
  )[0]!

function move(s: State, from: PlayerId, to: PlayerId, id: number, via: Asking, events: Event[]) {
  const card = take(s.players[from]!, id)
  s.players[to]!.hand.push(card)
  events.push({ t: 'moved', from, to, card, via })
}

/** Ends one of the current player's turns. */
function endTurn(s: State) {
  s.phase = { t: 'turn' }
  s.turns -= 1
  if (s.turns > 0) return
  s.current = nextAlive(s, s.current)
  s.turns = 1
  s.attacked = false
}

function explode(s: State, p: Player, kitten: Card, events: Event[]) {
  events.push({ t: 'exploded', player: p.id, hand: remove(s, p, kitten) })
  carryOn(s)
}

/** Out without drawing a kitten: whatever they were doing, or owed, no longer stands. */
function goOut(s: State, p: Player, why: Why, events: Event[]) {
  const ph = s.phase
  const theirs = s.current === p.id
  const ends = alive(s).length === 2
  // A play waiting out its Nope window drops onto the pile if it was theirs, or if the game ends with it.
  if (ph.t === 'window' && (theirs || ends)) s.discard.push(...ph.pending.cards, ...ph.nopes.map((n) => n.card))
  // A Favor they owe, or a steal from them, finds nothing.
  if ((ph.t === 'favor' && ph.from === p.id) || (ph.t === 'steal' && ph.victim === p.id)) s.phase = { t: 'turn' }
  // A drawn kitten is the current player's: in their hands, it goes off.
  const held = ph.t === 'kitten' || ph.t === 'place' ? ph.card : null
  const kitten = theirs ? held : null
  const hand = remove(s, p, kitten)
  if (!kitten) {
    // The deck's lowest goes in the box, so a peek at the top stays true. With none in the deck, the only
    // other player holds the last one: the game ends, and theirs goes in the box instead.
    const i = s.deck.findLastIndex((c) => c.kind === 'exploding-kitten')
    s.box.push(i >= 0 ? s.deck.splice(i, 1)[0]! : held!)
  }
  events.push({ t: 'out', player: p.id, why, hand, kitten })
  carryOn(s)
}

/** Takes `p` out of the game, with the kitten that went off in their hands; their hand goes to the discard pile. */
function remove(s: State, p: Player, kitten: Card | null): Card[] {
  const hand = p.hand
  p.alive = false
  p.kitten = kitten
  p.hand = []
  s.discard.push(...hand)
  return hand
}

/** After someone goes out: the last one left wins, or the next one alive takes over if it was their turn. */
function carryOn(s: State) {
  const left = alive(s)
  if (left.length === 1) s.phase = { t: 'over', winner: left[0]!.id }
  else if (!s.players[s.current]!.alive) {
    s.turns = 1 // going out ends every turn you owe
    endTurn(s)
  }
}
