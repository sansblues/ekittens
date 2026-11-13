import {
  attackTurns,
  found,
  lastIn,
  noped,
  targetOf,
  waitingOn,
  type Event,
  type Kind,
  type Pending,
  type PlayerId,
  type View,
} from '../engine'
import { Clock } from '../room'
import type { Input } from './browser'
import { aimedAtMe, hitsMe, isMe, told, type Drain, type Entry, type Snapshot, type TipOn } from './table'

// Card names and rules, and every line told from the game's state.

/** `{kind}` names a card; `{kind|word}` puts its emblem on any word about it (`{defuse|defusing}`). */
export const Mention = /\{([a-z-]+)(?:\|([^}]+))?\}/g

/** A line in plain words, each card by its name or word: what a screen reader says. */
export const toPlain = (text: string) => text.replace(Mention, (_, kind: Kind, word?: string) => word ?? Meta[kind].name)

const CatRule = 'Play two to steal a random card, or three to name one.'

const Stopped = 'Stopped by a {nope}'

export const Meta: Record<Kind, { name: string; rule: string }> = {
  'exploding-kitten': { name: 'Ekitten', rule: 'Draw this and you lose, unless you {defuse|defuse} it.' },
  defuse: { name: 'Defuse', rule: 'Stop an {exploding-kitten}, then hide it in the deck.' },
  nope: { name: 'Nope', rule: 'Stop any play, even another {nope}.' },
  attack: {
    name: 'Attack',
    rule: 'End your turn without drawing. The next player takes two turns, plus the rest of yours if you were attacked.',
  },
  skip: { name: 'Skip', rule: 'End your turn without drawing.' },
  favor: { name: 'Favor', rule: 'Pick a player. They pick a card to give you.' },
  shuffle: { name: 'Shuffle', rule: 'Shuffle the deck.' },
  'see-the-future': { name: 'Peek', rule: 'See the top three cards of the deck.' },
  tacocat: { name: 'Tacocat', rule: CatRule },
  cattermelon: { name: 'Melon', rule: CatRule },
  'hairy-potato-cat': { name: 'Potato', rule: CatRule },
  'beard-cat': { name: 'Beard', rule: CatRule },
  'rainbow-ralphing-cat': { name: 'Rainbow', rule: CatRule },
}

/** The deck's tip, written like a card's. */
export const Deck = { name: 'Deck', rule: 'Draw a card to end your turn.' }

/** What the deck's badge counts, told: "17 cards left, three of them Ekittens." */
export function left(count: number, kittens: number) {
  const n = inWords(count)
  const cards = `${n[0]!.toUpperCase()}${n.slice(1)} ${count === 1 ? 'card' : 'cards'} left`
  const them = '{exploding-kitten|Ekittens}'
  if (!kittens) return `${cards}.`
  if (kittens === count) return `${cards}, ${count === 1 ? one('exploding-kitten') : `${count === 2 ? 'both' : 'all'} ${them}`}.`
  return `${cards}, ${inWords(kittens)} of them ${kittens === 1 ? one('exploding-kitten') : them}.`
}

/** Who sits at the table, and which seat is yours. */
type Table = Pick<Snapshot, 'view' | 'cast'>

export const nameOf = ({ view, cast }: Table, id: PlayerId) => (isMe(view, id) ? 'You' : cast[id]!.name)
const whom = (table: Table, id: PlayerId) => (isMe(table.view, id) ? 'you' : nameOf(table, id))
export const whose = (table: Table, id: PlayerId) => (isMe(table.view, id) ? 'your' : `${nameOf(table, id)}’s`)

export const one = (kind: Kind) => `${/^[aeiou]/i.test(Meta[kind].name) ? 'an' : 'a'} {${kind}}`

/** A card's name in the plural: "Tacocats", "Potatoes". */
const plural = (kind: Kind) => Meta[kind].name + (Meta[kind].name.endsWith('o') ? 'es' : 's')

/** A number as a sentence says it: words up to ten, digits beyond. Chips and badges keep digits. */
const inWords = (n: number) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? `${n}`

/** "a", "a and b", "a, b and c". */
const inOrder = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** Several of a card: "two {tacocat|Tacocats}". */
export const many = (n: number, kind: Kind) => `${inWords(n)} {${kind}|${plural(kind)}}`

/** 1st, 2nd, 3rd, 4th… 11th, 12th, 13th… 21st. */
export function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** `e` comes redacted for you (see eventFor). */
export function logEntry(e: Event, table: Table): Entry | null {
  const name = (id: PlayerId) => nameOf(table, id)
  switch (e.t) {
    case 'played': {
      const { player, cards, named } = e.pending
      const kind = cards[0]!.kind
      const what = cards.length > 1 ? many(cards.length, kind) : one(kind)
      const at = e.at === null ? '' : ` on ${whom(table, e.at)}`
      return { who: player, text: `${name(player)} played ${what}${at}${named ? ` for ${one(named)}` : ''}` }
    }
    case 'noped': {
      // What it stops: the play, or the Nope before it.
      const { player, cards } = e.stops
      const kind = cards[0]!.kind
      const what = cards.length > 1 ? `{${kind}|${plural(kind)}}` : `{${kind}}`
      return { who: e.player, text: `${name(e.player)} {nope|noped} ${whose(table, player)} ${what}` }
    }
    case 'drew':
      return { who: e.player, text: `${name(e.player)} drew ${e.card ? one(e.card.kind) : 'a card'}` }
    case 'defused':
      return { who: e.player, text: `${name(e.player)} {defuse|defused} the {exploding-kitten}` }
    case 'placed':
      return { who: e.player, text: `${name(e.player)} hid the {exploding-kitten}` }
    case 'exploded':
      return { who: e.player, text: `${name(e.player)} {exploding-kitten|exploded}` }
    case 'out':
      return { who: e.player, text: `${name(e.player)} ${e.why === 'time' ? 'ran out of time' : 'left'}` }
    case 'moved': {
      const kind = e.card?.kind
      if (e.via === 'favor') return { who: e.from, text: `${name(e.from)} gave ${whom(table, e.to)} ${kind ? one(kind) : 'a card'}` }
      return {
        who: e.to,
        text: kind ? `${name(e.to)} took ${whose(table, e.from)} {${kind}}` : `${name(e.to)} took a card from ${name(e.from)}`,
      }
    }
    case 'missed':
      return { who: e.target, text: `${name(e.target)} had no ${e.named ? `{${e.named}}` : 'cards'}` }
    case 'saw':
      return isMe(table.view, e.player) ? { who: e.player, text: `You saw ${inOrder(e.cards.map((c) => `{${c.kind}}`))} on top` } : null
    default:
      return null
  }
}

/** Who played the card on stage (or its last Nope), and at whom; `hit` when it costs you. */
export function byline(snap: Snapshot): { from: PlayerId; to?: PlayerId; hit?: boolean } | null {
  const t = told(snap)
  const { view, beat, draft } = t
  const ph = view.phase
  if (draft) return null
  // A resolving play speaks for the state it leads to, so a Favor's label doesn't blink as its window closes.
  if (beat && beat.t !== 'resolve') return null
  switch (ph.t) {
    case 'window': {
      const last = ph.nopes.at(-1)
      if (last) return { from: last.player }
      const to = targetOf(view)
      return { from: ph.pending.player, ...(to !== null && { to }), hit: hitsMe(t) }
    }
    // A Favor or pair stays on stage while its card is picked, and so does its label.
    case 'favor':
      return { from: ph.to, to: ph.from, hit: isMe(view, ph.from) }
    case 'steal':
      return { from: ph.thief, to: ph.victim, hit: isMe(view, ph.victim) }
    default:
      return null
  }
}

interface Line {
  text: string
  /** open: you can Nope. danger: it costs you. kitten: an Ekitten drawn, going off or being defused. */
  tone?: 'open' | 'danger' | 'kitten'
  /** How much of the Nope window remains. */
  clock?: Drain | null
  /** Turns left, this one too, when more than one: a chip, "2 turns". */
  turns?: number
}

/** The pill's line: only what the scene doesn't already show. */
export function pill(snap: Snapshot): Line | null {
  if (snap.offline) return { text: 'Reconnecting…' }
  const t = told(snap)
  const { view, beat, draft } = t
  const ph = view.phase
  const name = (id: PlayerId) => nameOf(t, id)
  const windowClock = snap.windowAt === null ? null : { from: snap.windowAt, length: Clock.window }

  if (beat) {
    // The pill says the beat's log entry, in the log's own words.
    const said = beat.entry?.text ?? ''
    switch (beat.t) {
      case 'draw':
        // Until it's revealed, the card is just being drawn. A kitten's reveal is the news.
        if (beat.step === 'reveal' && beat.card.kind === 'exploding-kitten') return { text: said, tone: 'kitten' }
        return { text: isMe(view, beat.player) ? 'Drawing…' : `${name(beat.player)} is drawing…` }
      case 'boom':
        return isMe(view, beat.player) ? null : { text: said, tone: 'kitten' }
      case 'out':
        return isMe(view, beat.player) ? null : { text: said }
      case 'pass':
      case 'missed':
      case 'defuse':
      case 'place':
        return { text: said }
      case 'resolve':
        // A stopped play says so as it drops; otherwise the pill already speaks for what comes next.
        if (beat.noped) return { text: Stopped }
        break
      default:
        return null
    }
  }
  if (draft) return null

  switch (ph.t) {
    case 'window': {
      // A stopped play is untoned: it does nothing unless someone Nopes the Nope. The window lights up only for
      // one who holds a Nope to play into it.
      if (noped(ph)) return { text: Stopped, clock: windowClock }
      const open = view.hand.some((c) => c.kind === 'nope') && !isMe(view, lastIn(ph)) ? 'open' : undefined
      if (aimedAtMe(t)) return { text: stakes(ph.pending, view), tone: hitsMe(t) ? 'danger' : open, clock: windowClock }
      return { text: 'Anyone can {nope}', tone: open, clock: windowClock }
    }
    case 'favor':
    case 'steal': {
      const who = waitingOn(view)!
      return isMe(view, who) ? null : { text: `${name(who)} is picking a card…` } // the byline says from or for whom
    }
    case 'kitten':
      return isMe(view, view.current)
        ? { text: 'Play your {defuse}', tone: 'kitten' }
        : { text: `${name(view.current)} is {defuse|defusing}…`, tone: 'kitten' }
    case 'place':
      return isMe(view, view.current) ? null : { text: `${name(view.current)} is hiding the {exploding-kitten}…` }
    case 'turn':
      return {
        text: isMe(view, view.current) ? 'Your turn' : `${name(view.current)} is thinking…`,
        turns: view.turns > 1 ? view.turns : undefined,
      }
    case 'over':
      return null
  }
}

/** What a play aimed at you will do to you, if nobody Nopes it (or that it can't). */
function stakes({ effect, named }: Pending, view: View): string {
  if (effect === 'attack') return `You’ll take ${inWords(attackTurns(view))} turns`
  if (!found(view.hand, named)) return named ? `You have no {${named}}` : 'You have no cards'
  if (named) return `You’ll lose ${one(named)}`
  return effect === 'favor' ? 'You’ll give a card' : 'You’ll lose a card'
}

/** Some of a card, read aloud: "1 Ekitten", "3 Tacocats". */
export const counted = (n: number, kind: Kind) => `${n} ${n === 1 ? Meta[kind].name : plural(kind)}`

/** A hand's or the deck's size, read aloud. */
export const cardCount = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`

/** A table card's accessible name: the card or its stack, the deck's size and Ekittens, a triple's ask. */
export function label(p: { card: { kind: Kind | null }; up: boolean; count?: number; kittens?: number; asks?: Kind }, pile: boolean) {
  const { kind } = p.card
  const face = kind && p.up && (p.count ? counted(p.count, kind) : Meta[kind].name)
  const name = face || (p.count ? `${Deck.name}, ${cardCount(p.count)}` : 'Face-down card')
  const kittens = p.kittens ? `, ${counted(p.kittens, 'exploding-kitten')}` : ''
  return `${pile ? 'Discard pile: ' : ''}${name}${kittens}${p.asks ? `, any ${Meta[p.asks].name}?` : ''}`
}

/** A tip's last line, in the words of how you reach for the card. The deck's rule already says "draw", so a mouse needs no telling. */
export function hint(on: TipOn, input: Input): string | null {
  if (on === 'deck' && input === 'mouse') return null
  // A tap on your hand or the deck first lifts the card; one on the pile opens the log at once.
  const how = { key: 'Press Enter', mouse: 'Click', touch: on === 'pile' ? 'Tap' : 'Tap again' }[input]
  return `${how} to ${{ hand: 'play', deck: 'draw', pile: 'see what happened' }[on]}.`
}

/** Where the kitten goes, counted from the top. */
export const depth = (index: number, size: number) =>
  index === 0 ? 'On top' : index === size ? 'At the bottom' : `${ordinal(index + 1)} from the top`

export const topCards = (n: number) => (n === 1 ? 'The top card' : `The top ${inWords(n)} cards`)

export const asks = (kind: Kind) => `Any {${kind}}?`
