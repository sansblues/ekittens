import type { Card, Kind, PlayerId, View } from '../engine'
import { CardWidth, Depth, Face, Gutter, NameSize, Ratio, Text, Time, TipWidth } from './design'
import {
  canDraw,
  ended,
  groupHand,
  isMe,
  myMove,
  others,
  prompt,
  shownDeck,
  shownHand,
  shownMine,
  whyNot,
  type Shown,
  type Snapshot,
  type TipOn,
  type Zone,
} from './table'

// Every card is placed here, so any change of place animates by itself.

export interface Point {
  x: number
  y: number
}

/** A center-anchored rectangle. */
export interface Rect extends Point {
  w: number
  h: number
}

export interface Placed {
  card: Shown
  x: number
  y: number
  rot: number
  /** Rendered width in px. */
  w: number
  up: boolean
  z: number
  opacity: number
  dim: boolean
  /** Its shadow's depth (px). */
  lift: number
  /** The card a triple asks for, tagged on its stack. */
  asks?: Kind
  /** On the deck's top card: how many Ekittens the deck holds, as the table shows it. */
  kittens?: number
  /** What the moment asks you to act with (see `prompt`): ringed, lifted, and one tap acts. */
  act?: boolean
  /** The ×n badge: the cards in this stack, or in the deck. */
  count?: number
  /** Beneath the top of its stack, the deck or the pile: there for the eye alone, not the keyboard or a screen reader. */
  under?: boolean
  /** Lifted by your pointer, or by the moment. */
  raised?: boolean
  /** Too little of it shows for its name: its emblem alone, not half a word. */
  compact?: boolean
  /** Inside a bot's avatar: a trip out or in is a cue (see Cue). */
  seat?: boolean
  /** It steps back into the shade, but keeps its color (gray means "can't play"): the discard pile, so what you
   *  can act on leads; the deck, while you can't draw from it. */
  recede?: boolean
  /** Seconds before it fades. */
  wait?: number
  /** Where the card starts if it appears now, at width `w`: a dealt card waits there `dealt` seconds, and one
   *  from a bot's avatar sets off from inside it, as a cue. */
  from?: Point & { w?: number; dealt?: number; seat?: boolean }
  tremble?: boolean
  slam?: boolean
}

export interface Drag {
  ids: number[]
  zone: Zone
  over: boolean
  /** Let go on its zone, its move sent from this view: it stays where it fell until the room answers. */
  sent?: View
}

interface Screen {
  w: number
  h: number
  drag: Drag | null
  hover: number | null
  flinch: boolean
}

export interface Layout {
  /** The table's scale: text, avatars, the corner (1 on a large screen). */
  s: number
  /** Too small for the table's text at full size: each role takes the next step down. */
  compact: boolean
  /** You can draw: the deck, and the edges of the cards under it, out of the shade. */
  drawable: boolean
  /** The cards' scale: `s`, except on an upright screen, whose cards grow into its spare height. */
  k: number
  size: { hand: number; stage: number; avatar: number }
  cards: Placed[]
  seats: (Point & { id: PlayerId })[]
  /** The way the turn goes: a mark before the first seat (from you), between each seat and the next, and
   *  after the last (back to you). */
  order: (Point & { angle: number; room: number })[]
  byline: Point
  deck: Point
  discard: Point
  /** How many cards visibly lie on the deck (not one being pulled off, nor a kitten still being hidden). */
  pileCount: number
  zones: Record<Zone, Rect>
  /** Nothing on the stage: the piles show. */
  resting: boolean
  /** The discard pile's top card, while the piles show: it opens the log. */
  pileTop?: number
  spotlight: boolean
  pill: Point
  /** Seconds before the piles step aside: a drawn card leaves the deck in full view first. */
  stepAside: number
  /** The hovered card's tip, over it: its card, and what it's on. */
  tip: (Point & { p: Placed; on: TipOn }) | null
}

/** The table's scale and its fixed places, for a screen `vw` by `vh`: the same before a game and in it. */
function measure(vw: number, vh: number) {
  // Big screens get more room, never bigger things. A narrow screen stops shrinking at 0.72 (the
  // hand just fans tighter); a short one can't, or the table wouldn't fit.
  const s = Math.min(1, Math.max(0.72, vw / 960), vh / 900)
  // An upright screen has height to spare: its cards grow to the width instead of shrinking with the text.
  const k = vh > vw * 1.2 ? Math.min(1, (vw * 0.34) / 150, vh / 900) : s
  const size = { hand: CardWidth.hand * k, stage: CardWidth.stage * k, avatar: Face.seat * s }
  const stage = { x: vw / 2, y: vh * 0.45 }
  const deck = { x: vw / 2 - size.stage * 0.72, y: stage.y }
  const discard = { x: vw / 2 + size.stage * 0.72, y: stage.y }
  return { s, k, size, stage, deck, discard }
}

/** The others' seats on a gentle arc, in turn order. On a narrow screen the row spans the width, under
 *  the corner's button: it steps down to clear it. */
function arc<Id>(vw: number, s: number, ids: Id[]): (Point & { id: Id })[] {
  const narrow = vw < 640
  // A narrow row keeps close, yet takes what width it needs (a gutter and the end arrows' halves spare), so each
  // name has room.
  const gap = Math.min((narrow ? 120 : 220) * s, (vw - (narrow ? 2 * Gutter + 24 * s : 200 * s)) / Math.max(ids.length, 1))
  const row = (narrow ? 106 : 78) * s
  return ids.map((id, i) => {
    const o = i - (ids.length - 1) / 2
    const edge = ids.length > 1 ? Math.abs(o) / ((ids.length - 1) / 2) : 0
    return { id, x: vw / 2 + o * gap, y: row + edge * edge * 18 * s }
  })
}

/** Seat `i`, or one place past either end: the line from the seat before it, carried on (level, alone). */
function beyond(seats: Point[], i: number, vw: number, s: number): Point {
  if (seats[i]) return seats[i]
  const end = i < 0 ? seats[0]! : seats.at(-1)!
  const next = seats.length > 1 ? (i < 0 ? seats[1]! : seats.at(-2)!) : null
  const gap = next ? end.x - next.x : (i < 0 ? -1 : 1) * Math.min(220 * s, vw - 200 * s)
  return { x: end.x + gap, y: end.y + (next ? end.y - next.y : 0) }
}

export function place(snap: Snapshot, { w: vw, h: vh, drag, hover, flinch }: Screen): Layout {
  const { view, beat, draft, held } = snap
  const { s, k, size, stage, deck, discard } = measure(vw, vh)
  const cardH = size.stage * Ratio
  const handH = size.hand * Ratio
  const narrow = vw < 640
  const ph = view.phase
  const asked = prompt(snap)
  // During the deal, cards just fly: all in color, no counts yet.
  const dealing = beat?.t === 'deal'
  const dragged = new Set(drag?.ids)

  // The hand floats, every card in full view with air below it; it rises a little on your turn.
  const rise = 8 * k
  const raise = 24 * k // one card, hovered or asked for
  const handBase = vh - 40 * k - handH
  const handY = handBase + handH / 2 - (myMove(snap) || drag?.zone === 'hand' ? rise : 0) + (flinch ? 14 * k : 0)

  const seats = arc(vw, s, others(view))

  // A later `put` of the same card wins: what a beat shows overrides where the state left it.
  const placed = new Map<number, Placed>()
  const put = (card: Shown, p: Omit<Placed, 'card' | 'opacity' | 'dim' | 'lift'> & Partial<Placed>) =>
    placed.set(card.id, { opacity: 1, dim: false, lift: 2, ...p, card })
  // A bot's cards rest inside its avatar, unseen.
  const inSeat = (c: Shown, seat: Point, z: number, rot = 0) =>
    put(c, { x: seat.x, y: seat.y, rot, w: size.avatar * 0.5, up: false, z, opacity: 0, seat: true })
  // A card a bot plays or gives sets off from inside its avatar, if it isn't on the table already.
  const fromSeat = (player: PlayerId): Partial<Placed> => {
    const seat = seats.find((p) => p.id === player)
    return seat ? { from: { ...seat, w: size.avatar * 0.5, seat: true } } : {}
  }

  // While the stage is busy, the piles step aside: one thing at a time.
  const busy =
    ph.t !== 'turn' ||
    ended(snap) ||
    !!draft ||
    (!!drag && drag.zone !== 'hand') ||
    beat?.t === 'draw' ||
    beat?.t === 'pass' ||
    beat?.t === 'boom'

  const { cards: onDeck, kittens } = shownDeck(snap)
  // A hand going out joins the pile once its beat ends: until then, the pile is what lay there before.
  const going = new Set((beat?.t === 'boom' || beat?.t === 'out' || beat?.t === 'draw' ? (beat.hand ?? []) : []).map((c) => c.id))
  const pile = view.discard.filter((c) => !going.has(c.id)).slice(-2)
  const tipOn = ({ card, up }: Placed): TipOn | null => {
    if (canDraw(snap) && card.id === onDeck[0]?.id) return 'deck'
    if (!up) return null
    if (view.hand.some((c) => c.id === card.id)) return 'hand'
    return card.id === pile.at(-1)?.id && !busy ? 'pile' : null
  }

  for (const seat of seats) shownHand(snap, seat.id).forEach((c, i) => inSeat(c, seat, Depth.seat + i))

  const pileCount = onDeck.filter((c) => !dragged.has(c.id)).length
  // The ×n count rides on the top card still on the pile: a card you pull off takes none along.
  const counted = onDeck.find((c) => !dragged.has(c.id))
  // A Shuffle, once on the pile, cuts the deck: its top two cards part, then close.
  const shuffling = beat?.t === 'resolve' && !!beat.shuffle
  const cut = beat?.t === 'resolve' && beat.step === 'cut'
  // Its halves part a third of a card each way, tilting 8°; on a phone, the lower one stops a gutter clear of the
  // screen's side, its tilted corner too.
  const lean = (8 * Math.PI) / 180
  const lower = Math.max(deck.x - size.stage / 3, Gutter + (size.stage / 2) * (Math.cos(lean) + Ratio * Math.sin(lean)))
  const stepAside = beat?.t === 'draw' && beat.step === 'travel' ? Time.clear : 0
  // On your turn the deck comes forward, as a card you can play does.
  const drawable = canDraw(snap)
  onDeck.slice(0, 2).forEach((c, i) => {
    const act = i === 0 && asked === 'deck'
    const lifted = i === 0 && drawable && (hover === c.id || act) && !drag
    put(c, {
      x: cut ? (i === 0 ? deck.x + size.stage / 3 : lower) : deck.x,
      // A shuffle brings new cards to the top: they start from the pile, so the cut is seen.
      ...(shuffling && { from: deck }),
      y: deck.y - (lifted ? 12 * k : 0),
      rot: cut ? (i === 0 ? 8 : -8) : 0,
      w: size.stage,
      up: false,
      z: Depth.deck + 1 - i,
      opacity: busy ? 0 : 1,
      wait: stepAside,
      lift: lifted ? 7 : 2,
      raised: lifted,
      under: i > 0,
      act,
      recede: !drawable,
      ...(c === counted && !dealing && { count: pileCount, kittens }),
    })
  })
  pile.forEach((c, i) =>
    put(c, {
      ...discard,
      rot: tilt(c.id),
      w: size.stage,
      up: true,
      under: i < pile.length - 1,
      z: Depth.discard + i,
      opacity: busy ? 0 : 1,
      wait: stepAside,
      recede: hover !== pile.at(-1)?.id,
    }),
  )

  // Your hand: one card per kind, duplicates resting underneath.
  const drafted = new Set(draft?.cards.map((c) => c.id))
  const groups = groupHand(shownMine(snap).filter((c) => !drafted.has(c.id)))
  const n = groups.length
  const room = Math.min(vw - (narrow ? 2 * Gutter : 120 * s), 1100 * s)
  const step = n > 1 ? Math.min(size.hand * 0.82, (room - size.hand) / (n - 1)) : 0
  // A card's name needs its corner in view: the inset, its emblem and gap, and up to "Rainbow" (5.9 em).
  const tight = step < 0.08 * size.hand + Math.max(Text.caption, NameSize * size.hand) * 5.9
  const spread = Math.min(2.6, 30 / Math.max(n, 1))
  // The hand sags in an arc whose ends sink no lower than 11 cards' do: a 12th would carry them off-screen.
  const ends = Math.max((n - 1) / 2, 5)
  const sag = 1.3 * k * (5 / ends) ** 2
  // A card you just drew keeps its color until it has landed in your hand: one change at a time.
  const arriving = beat?.t === 'draw' ? beat.card.id : undefined
  const dimmed = (c: Card) => !dealing && c.id !== arriving && whyNot(snap, c) !== null
  let dealt = 0 // your hand is dealt left to right, as it will lie
  groups.forEach((group, i) => {
    const o = i - (n - 1) / 2
    const top = group[0]!
    const act = top.kind === asked && !dimmed(top)
    const raised = (group.some((c) => c.id === hover) && !drag) || act
    const base = {
      x: vw / 2 + o * step,
      y: handY + o * o * sag - (raised ? raise : 0),
      rot: o * spread,
      w: size.hand,
      up: true,
      dim: dimmed(top),
      raised,
      // Covered by its right-hand neighbor: emblem only. A lifted card, or the last, shows whole.
      compact: tight && !raised && i < n - 1,
    }
    // The ×n badge belongs to what stays in your hand, not to a card you're holding.
    const resting = group.filter((c) => !dragged.has(c.id))
    group.forEach((c, j) =>
      put(c, {
        ...base,
        y: base.y + j * 2 * k,
        z: (raised ? Depth.lifted : Depth.hand + i * 4) - j, // a lifted card comes to the front, whole
        lift: j === 0 ? (raised ? 7 : 3) : 1,
        act: j === 0 && act,
        under: c !== resting[0] && !dragged.has(c.id),
        ...(c === resting[0] && resting.length > 1 && !dealing && { count: resting.length }),
        ...(dealing && { from: { ...deck, dealt: dealt++ * Time.dealStep } }),
      }),
    )
  })

  const onStage = (c: Shown, extra: Partial<Placed> = {}) =>
    put(c, { ...stage, rot: 0, w: size.stage, up: true, z: Depth.stage, lift: 5, ...extra })
  // A card slapped onto the one on stage (a Nope, a Defuse): lower, so the one beneath keeps its name in view.
  const slapOn = (c: Shown, i = 0, under: number = Depth.stage, extra: Partial<Placed> = {}) =>
    onStage(c, { y: stage.y + nopeOffset(i + 1, k), rot: i % 2 ? 4 : -4, z: under + 10 + i, ...extra })
  // A small stack: the leader in front, the rest peeking out down and to the right.
  const stack = (cards: Card[], extra: Partial<Placed> = {}, asks?: Kind) =>
    cards.forEach((c, i) =>
      onStage(c, {
        x: stage.x + i * 8 * k,
        y: stage.y + i * 6 * k,
        rot: i === 0 ? 0 : i % 2 ? 3 : -2,
        z: Depth.stage - i,
        lift: i === 0 ? 5 : 2,
        ...(i === 0 && cards.length > 1 && { count: cards.length }),
        ...(i === 0 && asks && { asks }),
        ...extra,
      }),
    )

  if (ph.t === 'window') {
    stack(ph.pending.cards, fromSeat(ph.pending.player), ph.pending.named ?? undefined)
    ph.nopes.forEach(({ card, player }, i) => slapOn(card, i, Depth.stage, fromSeat(player)))
  }
  // While a sheet asks about your play, its cards wait on stage unseen: the sheet shows them.
  if (draft) stack(draft.cards, { opacity: 0 })
  if (ph.t === 'favor' || ph.t === 'steal') stack(held)
  // A kitten stays on stage until hidden (yours too, behind your sheet), its Defuse (the pile's top by now) on it.
  if (ph.t === 'kitten' || ph.t === 'place') onStage(ph.card, { lift: 8, z: Depth.moment })
  // It comes from the defuser's seat, as any card played there does (your own comes from your hand already).
  if (ph.t === 'place') slapOn(ph.defuse, 0, Depth.moment, fromSeat(view.current))
  if (beat?.t === 'place' && beat.step === 'slide') slapOn(beat.defuse, 0, Depth.moment, fromSeat(beat.player))

  if (beat?.t === 'draw' && beat.step !== 'settle') {
    const kitten = beat.card.kind === 'exploding-kitten'
    const shown = beat.step === 'reveal' && (isMe(view, beat.player) || kitten)
    onStage(beat.card, {
      from: { ...deck, w: size.stage },
      up: shown,
      lift: beat.step === 'suspense' ? 4 : 10,
      z: Depth.moment,
      w: shown && kitten ? size.stage * 1.15 : size.stage,
      tremble: beat.step === 'suspense',
      slam: shown && kitten,
    })
  }
  // A card changing hands lands on the play that asked for it, like a Nope; the play stays above the dim until the card is home.
  if (beat?.t === 'pass') {
    const nopes = beat.done.filter((c) => c.kind === 'nope')
    stack(
      beat.done.filter((c) => c.kind !== 'nope'),
      { z: Depth.context },
    )
    nopes.forEach((c, i) => slapOn(c, i, Depth.context))
    if (beat.step === 'held')
      slapOn(beat.card, nopes.length, Depth.stage, { z: Depth.moment, lift: 8, up: beat.card.kind !== null, ...fromSeat(beat.from) })
    // Then it goes home: into another's seat, where it melts in, as any card reaching a seat does (into
    // your own hand, it simply joins it).
    const seat = seats.find((p) => p.id === beat.to)
    if (beat.step === 'home' && seat)
      put(beat.card, { ...seat, rot: 0, w: size.avatar * 0.5, up: beat.card.kind !== null, z: Depth.moment, opacity: 0, seat: true })
  }
  // Hidden: under the deck's top card, wherever it really went.
  if (beat?.t === 'place') put(beat.kitten, { ...deck, rot: 0, w: size.stage, up: false, z: Depth.deck - 1 })
  // They land on top of the pile, where they'll stay: never sliding under its top card first.
  if (beat?.t === 'resolve')
    beat.cards.forEach((c, i) => put(c, { ...discard, rot: tilt(c.id), w: size.stage, up: true, z: Depth.discard + 10 + i }))
  if (beat?.t === 'out') {
    // A kitten leaves the deck with them, face up; their hand goes with it, out of sight.
    const seat = seats.find((p) => p.id === beat.player)
    const to = seat ?? { x: vw / 2, y: vh + size.stage }
    put(beat.kitten, {
      ...to,
      from: { ...deck, w: size.stage },
      rot: 0,
      w: seat ? size.avatar * 0.5 : size.stage,
      up: true,
      z: Depth.moment,
      opacity: seat ? 0 : 1,
      seat: !!seat,
    })
    beat.hand.forEach((c, i) =>
      seat ? inSeat(c, seat, Depth.seat + 10 + i) : put(c, { ...to, rot: 0, w: size.hand, up: true, z: Depth.hand + i, opacity: 0 }),
    )
  }
  if (beat?.t === 'boom') {
    // Your hand falls off the screen; a bot's, into its avatar.
    onStage(beat.kitten, { z: Depth.moment, lift: 10, w: size.stage * 1.3, slam: true })
    const seat = seats.find((p) => p.id === beat.player)
    beat.hand.forEach((c, i) => {
      const o = i - (beat.hand.length - 1) / 2
      if (seat) inSeat(c, seat, Depth.seat + 10 + i, o * 20)
      else put(c, { x: vw / 2 + o * 90 * k, y: vh + 40 * k, rot: o * 18, w: size.hand, up: true, z: Depth.hand + i, opacity: 0 })
    })
  }
  const mine = view.me === null ? null : view.players[view.me]!
  if (ended(snap) && mine && !mine.alive && mine.kitten) onStage(mine.kitten, { lift: 8 })
  for (const seat of seats) {
    const out = view.players[seat.id]!
    // Not while it's still being drawn or exploding: the state is already past that moment.
    if (!out.alive && out.kitten && !((beat?.t === 'draw' || beat?.t === 'boom') && beat.player === seat.id))
      inSeat(out.kitten, seat, Depth.seat + 20)
  }

  // Every draw is suspense, whoever draws, until the card heads to its owner.
  const spotlight =
    (beat?.t === 'draw' && beat.step !== 'settle') ||
    (beat?.t === 'pass' && beat.step === 'held' && (isMe(view, beat.from) || isMe(view, beat.to))) ||
    beat?.t === 'boom' ||
    ((ph.t === 'kitten' || ph.t === 'place') && !isMe(view, view.current))

  // The hovered card's tip: over it, but always a gutter clear of the screen's sides (and its top: see .tip).
  const pointed = hover === null || drag ? undefined : placed.get(hover)
  const on = pointed && tipOn(pointed)
  const tip =
    pointed && on
      ? {
          p: pointed,
          on,
          x: Math.min(Math.max(pointed.x, TipWidth / 2 + Gutter), vw - TipWidth / 2 - Gutter),
          y: pointed.y - (pointed.w * Ratio) / 2 - 12 * s,
        }
      : null

  const nopes = ph.t === 'window' ? ph.nopes.length : 0
  // The pill sits above the highest your hand reaches, so it never bobs with it; on a short screen,
  // midway between that and the lowest the stage reaches (a play under a tall Nope stack).
  const handReach = handBase - rise - raise - 7 * k
  const stageReach = stage.y + cardH / 2 + nopeOffset(4, k) + 5 * k
  return {
    s,
    compact: s < 0.9,
    drawable,
    k,
    size,
    cards: [...placed.values()],
    seats,
    order: seats.length
      ? Array.from({ length: seats.length + 1 }, (_, j) => {
          const [a, b] = [beyond(seats, j - 1, vw, s), beyond(seats, j, vw, s)]
          // A little above the line between the places, level with the faces; `room`: the gap between them,
          // less 4 px on each side.
          return {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2 - size.avatar * 0.15,
            angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
            room: Math.hypot(b.x - a.x, b.y - a.y) - size.avatar - 8,
          }
        })
      : [],
    deck,
    discard,
    pileCount,
    zones: {
      slot: { ...stage, w: size.stage * 1.25, h: cardH * 1.18 },
      card: { x: stage.x, y: stage.y + nopeOffset(nopes, k) / 2, w: size.stage * 1.22, h: cardH * 1.12 + nopeOffset(nopes, k) },
      // Drawing: a wide zone around your hand, with all four edges in view.
      hand: { x: vw / 2, y: handY + 6 * k, w: vw - 48, h: handH + 64 * k },
    },
    resting: !busy,
    pileTop: busy ? undefined : pile.at(-1)?.id,
    spotlight,
    pill: { x: vw / 2, y: Math.max(handReach - 43 * s, (stageReach + handReach) / 2) },
    byline: { x: stage.x, y: stage.y - cardH / 2 - Math.max(22, 32 * s) },
    stepAside,
    tip,
  }
}

/** How far the n-th Nope sits below the card it fights (the growth is capped), at card scale k. */
const nopeOffset = (n: number, k: number) => (n === 0 ? 0 : (44 + Math.min(n - 1, 3) * 8) * k)

/** A small, stable tilt for a card on the discard pile. */
const tilt = (id: number) => ((id * 37) % 7) - 3

export const at = (x: number, y: number) => ({ position: 'absolute' as const, left: x, top: y, translate: '-50% -50%' })
