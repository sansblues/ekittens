import {
  Kinds,
  found,
  isCat,
  lastIn,
  noped,
  targetOf,
  waitingOn,
  type Action,
  type Card,
  type Kind,
  type PlayerId,
  type View,
} from '../engine'
import { Clock, type Cast } from '../room'

// The table lags the engine on purpose: each change waits for the beat that shows it. It sees only your
// seat's View: the deck and other hands are counts, shown as cards with no face.

/** Whether `id` is your seat; nobody is, to someone watching. */
export const isMe = (view: View, id: PlayerId | null) => id !== null && id === view.me

/** Everyone else, in turn order from whoever plays after you; someone watching sees everyone. */
export function others(view: View): PlayerId[] {
  const n = view.players.length
  const first = view.me === null ? 0 : view.me + 1
  return Array.from({ length: view.me === null ? n : n - 1 }, (_, i) => (first + i) % n)
}

/** One thing that happened, in words, led by whoever did it. Cards are written `{kind}`. */
export interface Entry {
  who: PlayerId
  text: string
}

export type LogLine = Entry & { id: number }

/** A card as your seat sees it: `kind` is null for one you may not see (in the deck, in another's hand). */
export interface Shown {
  id: number
  kind: Kind | null
}

// Unseen cards get ids of their own, below every real one: the deck's counted up from its bottom, so the
// top keeps its id as cards are drawn; a hand's by seat and place, so a drawn card keeps its id once home.
const deckId = (count: number, i: number) => -(count - i)
export const handId = (player: PlayerId, i: number) => -1000 * (player + 1) - i

/** Unseen cards, `count` of them, by their ids. */
const unseen = (count: number, id: (i: number) => number): Shown[] => Array.from({ length: count }, (_, i) => ({ id: id(i), kind: null }))

/** A short moment the table holds so a change can be seen; it carries the log entry it shows. */
export type Beat = { entry?: Entry } & (
  | { t: 'deal' }
  /** `hand` is set when this draw blows the player up: they hold it until the boom. */
  | { t: 'draw'; player: PlayerId; card: Shown; step: 'travel' | 'suspense' | 'reveal' | 'settle'; hand?: Card[] }
  /** A card changing hands. `done` is the play that asked for it: it stays on stage until the card is home. */
  | { t: 'pass'; card: Shown; from: PlayerId; to: PlayerId; done: Card[]; step: 'held' | 'home' }
  | { t: 'boom'; player: PlayerId; kitten: Card; hand: Card[] }
  /** Someone goes out holding no kitten: one leaves the deck with them, face up, and their hand goes. */
  | { t: 'out'; player: PlayerId; kitten: Shown; hand: Card[] }
  | { t: 'future'; cards: Card[] }
  /** A bot's card on its way to the stage. Until it lands, the table speaks for the state before it. */
  | { t: 'land'; prior: View }
  /** Cards dropping onto the discard pile. A Shuffle then cuts the deck: it parts, then closes. */
  | { t: 'resolve'; cards: Card[]; noped: boolean; shuffle?: true; step: 'drop' | 'cut' | 'close' }
  | { t: 'defuse' }
  /** The kitten slides into the deck; once it's in, its Defuse drops onto the pile. */
  | { t: 'place'; player: PlayerId; kitten: Card; defuse: Card; step: 'slide' | 'hidden' }
  | { t: 'missed' }
)

/** Your move's clock, including the time already spent before a reconnect. */
export function myClock({ view, clock }: Snapshot): Drain | null {
  return clock && isMe(view, clock.seat) ? { from: clock.ends - Clock.move, length: Clock.move } : null
}

/** A clock draining away: from when it started (s), over how long. */
export interface Drain {
  from: number
  length: number
}

/** Your play in the making, dropped on the stage, waiting for your answers. */
type Draft = { step: 'size' | 'target'; cards: Card[] } | { step: 'name'; cards: Card[]; target: PlayerId }

export interface Snapshot {
  view: View
  cast: Cast
  beat: Beat | null
  draft: Draft | null
  /** When the current Nope window's clock started (s); null until the room starts it. */
  windowAt: number | null
  /** The line to the room has dropped: nothing can be done until it's back. */
  offline: boolean
  /** Out of a game with friends, you chose to watch it to the end. */
  watching: boolean
  /** Whose move the clock runs on, when it ends (s), and whether time is nearly up. */
  clock: { seat: PlayerId; ends: number; near: boolean } | null
  /** The Favor or pair that set up the current give or steal, kept on stage. */
  held: Card[]
  /** What happened, oldest first. */
  log: LogLine[]
}

export function groupHand(hand: Card[]): Card[][] {
  const groups: Card[][] = []
  for (const c of hand.toSorted((a, b) => Kinds.indexOf(a.kind) - Kinds.indexOf(b.kind) || a.id - b.id)) {
    const last = groups.at(-1)
    if (last?.[0]!.kind === c.kind) last.push(c)
    else groups.push([c])
  }
  return groups
}

/** `card`, and for a cat up to two of its twins. */
export function twins(view: View, card: Card): Card[] {
  const same = view.hand.filter((c) => c.kind === card.kind && c.id !== card.id)
  return isCat(card.kind) && same.length > 0 ? [card, ...same].slice(0, 3) : [card]
}

/** The game is over for you: it ended, or you're out (the bots' game then means nothing). Someone watching watches to the end. */
export const doneFor = (view: View) => view.phase.t === 'over' || (view.me !== null && !view.players[view.me]!.alive)

/** The end sheet's moment: the game is over, or you're out and not watching. */
export const ended = ({ view, beat, watching }: Snapshot) => !beat && (view.phase.t === 'over' || (doneFor(view) && !watching))

export const myMove = ({ view, beat, offline }: Snapshot) => !beat && !offline && isMe(view, waitingOn(view))

export const canDraw = (snap: Snapshot) => myMove(snap) && snap.view.phase.t === 'turn' && !snap.draft

/** Who a Favor or cat could ask: anyone else still in, holding a card. */
export const targets = (view: View) => view.players.filter((p) => p.alive && !isMe(view, p.id) && p.cards > 0).map((p) => p.id)

/** The table as it speaks: a bot's card still on its way speaks for the state before it. */
export const told = (snap: Snapshot): Snapshot => (snap.beat?.t === 'land' ? { ...snap, view: snap.beat.prior, beat: null } : snap)

/** What a beat keeps from `id`'s hand: a drawn or passed card joins once home; an exploding player holds theirs
 *  until the boom. A kitten never joins, so it takes nothing away: a hand one short would give it away. */
function beatOn({ beat }: Snapshot, id: PlayerId): { hand?: Card[]; coming?: Shown } {
  if (beat?.t === 'draw' && beat.player === id) {
    if (beat.hand) return { hand: beat.hand }
    return beat.step === 'settle' || beat.card.kind === 'exploding-kitten' ? {} : { coming: beat.card }
  }
  if ((beat?.t === 'boom' || beat?.t === 'out') && beat.player === id) return { hand: [] }
  if (beat?.t === 'pass' && beat.to === id && beat.step === 'held') return { coming: beat.card }
  return {}
}

/** Your hand as the table shows it. */
export function shownMine(snap: Snapshot): Card[] {
  const { me, hand } = snap.view
  if (me === null) return hand
  const shown = beatOn(snap, me)
  return shown.hand ?? hand.filter((c) => c.id !== shown.coming?.id)
}

/** A hand as the table shows it. Another's is unseen: a card on its way in is its last. */
export function shownHand(snap: Snapshot, id: PlayerId): Shown[] {
  if (isMe(snap.view, id)) return shownMine(snap)
  const { hand, coming } = beatOn(snap, id)
  return hand ?? unseen(snap.view.players[id]!.cards - (coming ? 1 : 0), (i) => handId(id, i))
}

/** A kitten being hidden joins once it's in, so nothing gives away where; a drawn one counts until revealed. */
export function shownDeck({ view, beat }: Snapshot): { cards: Shown[]; kittens: number } {
  const hiding = beat?.t === 'place' ? 1 : 0
  const drawn = beat?.t === 'draw' && (beat.step === 'travel' || beat.step === 'suspense') && beat.card.kind === 'exploding-kitten'
  const count = view.deck - hiding
  return { cards: unseen(count, (i) => deckId(count, i)), kittens: view.kittens - hiding + (drawn ? 1 : 0) }
}

/** A player drawing, hiding a kitten or exploding visibly keeps the turn until that ends. Out, the turn shows
 *  only while you watch. */
export function onTurn({ view, beat, watching }: Snapshot): PlayerId | null {
  if (beat?.t === 'deal') return null
  // The beat before the state: a fatal draw has already ended the game, but mustn't say so yet.
  if (beat?.t === 'draw' || beat?.t === 'boom' || beat?.t === 'place') return beat.player
  return view.phase.t === 'over' || (doneFor(view) && !watching) ? null : view.current
}

/** An exploding player still looks alive until the boom. */
export const shownAlive = ({ view, beat }: Snapshot, id: PlayerId) => view.players[id]!.alive || (beat?.t === 'draw' && beat.player === id)

export function aimedAtMe({ view }: Snapshot): boolean {
  return view.phase.t === 'window' && !isMe(view, view.phase.pending.player) && isMe(view, targetOf(view))
}

/** Aimed at you and costly: an Attack, or a Favor, pair or triple that would find a card. */
export function hitsMe(snap: Snapshot): boolean {
  const ph = snap.view.phase
  if (ph.t !== 'window' || !aimedAtMe(snap)) return false
  const { effect, named } = ph.pending
  return effect === 'attack' || found(snap.view.hand, named) !== undefined
}

/** The window's id while its play is set to cost you; a Nope of its Nope renews the threat. */
export function threat(snap: Snapshot): number | null {
  const ph = snap.view.phase
  return !snap.beat && ph.t === 'window' && !noped(ph) && hitsMe(snap) ? ph.id : null
}

/** Why you can't use `c` now, or null; a card with a reason is gray, can't be picked up, and its tip says why. */
export function whyNot(snap: Snapshot, c: Card): string | null {
  const { view, beat, draft, offline } = snap
  const ph = view.phase
  // The beat before the state, as in `onTurn`: a hand lighting up mid-draw would give the kitten away.
  if (beat || draft || offline) return 'One moment.'
  if (doneFor(view)) return null // nothing to do with your hand here, and nothing to gray out
  // Your own play or Nope waits on the others; and nobody's Nope counts before the window's clock runs.
  if (ph.t === 'window') {
    if (snap.windowAt === null) return 'One moment.'
    if (isMe(view, lastIn(ph))) return 'Waiting for any {nope}.'
    return c.kind === 'nope' ? null : 'Only a {nope} works now.'
  }
  if (ph.t === 'kitten' && isMe(view, view.current)) return c.kind === 'defuse' ? null : 'First, {defuse|defuse} the {exploding-kitten}.'
  if (c.kind === 'nope') return 'Nothing to stop right now.'
  if (c.kind === 'defuse') return 'Saved for when you draw an {exploding-kitten}.'
  if (!isMe(view, view.current)) return 'Not your turn.'
  if (ph.t !== 'turn') return 'One moment.'
  const anyone = targets(view).length > 0
  if (c.kind === 'favor') return anyone ? null : 'Nobody has a card to give.'
  if (isCat(c.kind)) {
    if (twins(view, c).length < 2) return `Needs a second {${c.kind}}.`
    return anyone ? null : 'Nobody has a card to take.'
  }
  return null
}

/** What the moment asks you to act with; the deck only when nothing in your hand can be played. */
export function prompt(snap: Snapshot): 'nope' | 'defuse' | 'deck' | null {
  const { view, beat } = snap
  if (threat(snap) !== null) return 'nope'
  if (!beat && view.phase.t === 'kitten' && isMe(view, view.current)) return 'defuse'
  if (canDraw(snap) && view.hand.every((c) => whyNot(snap, c) !== null)) return 'deck'
  return null
}

export function sheet(snap: Snapshot) {
  const { view, beat, draft, offline } = snap
  const ph = view.phase
  if (ended(snap)) return 'end'
  if (beat?.t === 'future') return 'future'
  if (draft) return draft.step
  // A play resolving into its next step: the sheet that step needs may already rise. Offline, an answer would go
  // nowhere: the pill says why, and the sheet comes back with the line.
  if (!offline && (!beat || beat.t === 'resolve')) {
    if (ph.t === 'steal' && isMe(view, ph.thief)) return 'pick'
    if (ph.t === 'favor' && isMe(view, ph.from)) return 'give'
    if (ph.t === 'place' && isMe(view, view.current)) return 'place'
  }
  return null
}

/** A move you make with a card. A play carries only its card: it may still ask its questions on a sheet. */
export type Move = Extract<Action, { t: 'nope' | 'defuse' | 'draw' }> | { t: 'play'; card: Card }

/** Where a picked-up card drops: the stage's slot, the card on stage, or your hand (a draw). */
export type Zone = 'slot' | 'card' | 'hand'

/** What a card with a tip lies on. */
export type TipOn = 'hand' | 'deck' | 'pile'

export function grab(snap: Snapshot, shown: Shown): { move: Move; ids: number[]; zone: Zone } | null {
  const { view, beat, draft } = snap
  const { me } = view
  if (beat || draft || me === null || doneFor(view)) return null
  const ph = view.phase
  const card = view.hand.find((c) => c.id === shown.id)
  if (card) {
    if (whyNot(snap, card) !== null) return null
    // A Nope onto a play, bound to its window: if another opens mid-drag, the drop does nothing.
    if (ph.t === 'window') return { move: { t: 'nope', player: me, card: card.id, id: ph.id }, ids: [card.id], zone: 'card' }
    if (ph.t === 'kitten') return { move: { t: 'defuse', player: me, card: card.id }, ids: [card.id], zone: 'card' }
    return { move: { t: 'play', card }, ids: twins(view, card).map((c) => c.id), zone: 'slot' }
  }
  return canDraw(snap) && shownDeck(snap).cards[0]?.id === shown.id
    ? { move: { t: 'draw', player: me }, ids: [shown.id], zone: 'hand' }
    : null
}
