import { describe, expect, it } from 'vitest'
import { apply, seeded, view, type Card, type Kind, type State } from '../engine'
import { grab, myMove, onTurn, prompt, sheet, shownDeck, shownHand, threat, whyNot, type Beat, type Snapshot } from './table'

let ids = 0
const cards = (kinds: string) =>
  kinds
    .split(' ')
    .filter(Boolean)
    .map((kind): Card => ({ id: ids++, kind: kind as Kind }))

/** A table with you at seat 0, as your seat sees it; the deck lists its top first. */
function at(hands: string[], deck = 'skip skip', rest: Partial<State> = {}): Snapshot & { state: State } {
  const state: State = {
    players: hands.map((h, id) => ({ id, hand: cards(h), alive: true, kitten: null })),
    deck: cards(deck),
    discard: [],
    current: 0,
    turns: 1,
    attacked: false,
    phase: { t: 'turn' },
    windows: 0,
    rng: seeded(1),
    box: [],
    ...rest,
  }
  return seen(state, {
    cast: hands.map((_, face) => ({ face, name: '', bot: face > 0 })),
    beat: null,
    draft: null,
    windowAt: 0,
    offline: false,
    watching: false,
    clock: null,
    held: [],
    log: [],
  })
}

/** The snapshot of `state` from your seat, carrying the state for the next move. */
const seen = (state: State, rest: Omit<Snapshot, 'view'>) => ({ ...rest, state, view: view(state, 0) })

const mine = (s: Snapshot, kind: Kind) => s.view.hand.find((c) => c.kind === kind)!
const then = (s: ReturnType<typeof at>, ...steps: ((st: State) => Parameters<typeof apply>[1])[]) =>
  steps.reduce((acc, step) => seen(apply(acc.state, step(acc.state)).state, acc), s)
const windowOf = (st: State) => (st.phase.t === 'window' ? st.phase.id : -1)

describe('table', () => {
  it('says why a card of yours can’t be played', () => {
    const s = at(['tacocat favor nope defuse skip', ''])
    expect(['tacocat', 'favor', 'nope', 'defuse', 'skip'].map((k) => whyNot(s, mine(s, k as Kind)))).toEqual([
      'Needs a second {tacocat}.',
      'Nobody has a card to give.',
      'Nothing to stop right now.',
      'Saved for when you draw an {exploding-kitten}.',
      null,
    ])
    expect(whyNot({ ...s, beat: { t: 'deal' } }, mine(s, 'skip'))).toBe('One moment.')
    expect(whyNot({ ...s, view: { ...s.view, current: 1 } }, mine(s, 'skip'))).toBe('Not your turn.')
  })

  it('renews a threat each time its play stands again', () => {
    const s = at(['nope nope', 'attack nope'], 'skip', { current: 1 })
    const played = then(s, (st) => ({ t: 'play', player: 1, cards: [st.players[1]!.hand[0]!.id] }))
    expect(threat(played)).toBe(windowOf(played.state))
    const noped = then(played, (st) => ({ t: 'nope', player: 0, card: st.players[0]!.hand[0]!.id, id: windowOf(st) }))
    expect(threat(noped)).toBeNull()
    const back = then(noped, (st) => ({ t: 'nope', player: 1, card: st.players[1]!.hand[0]!.id, id: windowOf(st) }))
    expect(threat(back)).toBe(windowOf(back.state))
    expect(prompt(back)).toBe('nope')
    // Your Nope stands: a second (a double tap) would only stop your own. Nor does one count before the room's
    // clock for the window runs.
    expect(whyNot(noped, mine(noped, 'nope'))).toBe('Waiting for any {nope}.')
    expect(whyNot({ ...back, windowAt: null }, mine(back, 'nope'))).toBe('One moment.')
    expect(whyNot(back, mine(back, 'nope'))).toBeNull()
    expect(threat({ ...back, beat: { t: 'land', prior: noped.view } })).toBeNull() // not until it lands
    expect(prompt(at(['nope', 'skip']))).toBe('deck') // nothing else in hand can be played
  })

  it('shows a card coming into a hand only once it is home, and an exploding hand until the boom', () => {
    const s = at(['skip', 'nope attack'])
    const drawn = s.view.hand[0]!
    const draw = (step: 'travel' | 'settle', hand?: Card[]) => ({ t: 'draw', player: 0, card: drawn, step, hand }) as const
    expect(shownHand({ ...s, beat: draw('travel') }, 0)).toEqual([])
    expect(shownHand({ ...s, beat: draw('settle') }, 0)).toEqual([drawn])
    const before = cards('nope attack')
    expect(shownHand({ ...s, view: { ...s.view, hand: [] }, beat: draw('travel', before) }, 0)).toEqual(before)
    expect(shownHand({ ...s, beat: { t: 'boom', player: 0, kitten: drawn, hand: before } }, 0)).toEqual([])
    // Another's hand is unseen, and a card on its way into it isn't counted yet, even one you can see.
    const pass: Beat = { t: 'pass', card: drawn, from: 0, to: 1, done: [], step: 'held' }
    expect(shownHand({ ...s, beat: pass }, 1)).toEqual([{ id: expect.any(Number), kind: null }])
  })

  it('gives nothing away while a draw is still on its way', () => {
    const s = at(['skip', 'skip'], 'exploding-kitten')
    const hand = s.state.players[0]!.hand

    const drawn = then(s, () => ({ t: 'draw', player: 0 }))
    const travel = { ...drawn, beat: { t: 'draw', player: 0, card: s.state.deck[0]!, step: 'travel', hand } } as const

    expect(onTurn(travel)).toBe(0)
    expect(whyNot(travel, hand[0]!)).toBe('One moment.')

    // Another's hand holds steady as they draw, kitten or not: a kitten never joins it.
    const theirs = (deck: string) => {
      const t = at(['skip', 'defuse skip'], deck, { current: 1 })
      const drew = then(t, () => ({ t: 'draw', player: 1 }))
      return shownHand({ ...drew, beat: { t: 'draw', player: 1, card: t.state.deck[0]!, step: 'travel' } }, 1).length
    }
    expect([theirs('exploding-kitten skip'), theirs('skip')]).toEqual([2, 2])
  })

  it('raises the sheet a play leads to while it still drops, and the end over anything', () => {
    const s = at(['skip', 'favor'], 'skip', { phase: { t: 'favor', from: 0, to: 1 } })
    const resolve: Beat = { t: 'resolve', cards: [], noped: false, step: 'drop' }
    expect(sheet({ ...s, beat: resolve })).toBe('give')
    expect(sheet({ ...s, beat: { t: 'missed' } })).toBeNull()
    const over = { ...s, view: { ...s.view, phase: { t: 'over', winner: 1 } } } as Snapshot
    expect(sheet({ ...over, draft: { step: 'target', cards: [] } })).toBe('end')
  })

  it('gives someone watching nothing to do, even when the game waits on nobody', () => {
    const s = at(['skip', 'attack nope'], 'skip', { current: 1 })
    const played = then(s, (st) => ({ t: 'play', player: 1, cards: [st.players[1]!.hand[0]!.id] }))
    for (const t of [s, played]) {
      const watching = { ...t, view: view(t.state, null) }
      expect([myMove(watching), prompt(watching), sheet(watching), grab(watching, shownDeck(watching).cards[0]!)]).toEqual([
        false,
        null,
        null,
        null,
      ])
      expect(shownHand(watching, 1)).toHaveLength(t.state.players[1]!.hand.length)
    }
  })

  it('shows whose turn it is to anyone watching, out of the game too', () => {
    const s = at(['skip', 'skip', 'skip'], 'skip', { current: 1 })
    const out = { ...s, view: { ...s.view, players: s.view.players.map((p) => ({ ...p, alive: p.id > 0 })) } }
    expect([onTurn({ ...s, view: view(s.state, null) }), onTurn({ ...out, watching: true }), onTurn(out)]).toEqual([1, 1, null])
  })

  it('knows what picking up a card does', () => {
    const s = at(['tacocat tacocat skip', 'nope'])
    expect(grab(s, mine(s, 'tacocat'))).toMatchObject({
      move: { t: 'play' },
      ids: [mine(s, 'tacocat').id, expect.any(Number)],
      zone: 'slot',
    })
    const [top, next] = shownDeck(s).cards
    expect(grab(s, top!)).toMatchObject({ move: { t: 'draw' }, zone: 'hand' })
    expect(grab(s, next!)).toBeNull()
    expect(grab({ ...s, beat: { t: 'deal' } }, mine(s, 'skip'))).toBeNull()
  })
})
