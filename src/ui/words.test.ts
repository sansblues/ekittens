import { describe, expect, it } from 'vitest'
import { setup, view, type Card, type Event, type Pending } from '../engine'
import { hint, label, left, logEntry, many, one, ordinal } from './words'

describe('words', () => {
  it('counts and names cards the way people say them', () => {
    expect([one('attack'), one('skip'), many(2, 'hairy-potato-cat'), many(3, 'tacocat')]).toEqual([
      'an {attack}',
      'a {skip}',
      'two {hairy-potato-cat|Potatoes}',
      'three {tacocat|Tacocats}',
    ])
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
    expect([left(17, 3), left(5, 1), left(2, 2), left(1, 1), left(1, 0)]).toEqual([
      '17 cards left, three of them {exploding-kitten|Ekittens}.',
      'Five cards left, one of them an {exploding-kitten}.',
      'Two cards left, both {exploding-kitten|Ekittens}.',
      'One card left, an {exploding-kitten}.',
      'One card left.',
    ])
  })

  it('logs what happened, as you saw it', () => {
    const table = { view: view(setup(3, 1), 0), cast: ['Leo', 'Bob', 'Frank'].map((name, face) => ({ face, name, bot: face > 0 })) }
    const line = (e: Event) => logEntry(e, table)?.text
    const tacocats: Card[] = [0, 1, 2].map((id) => ({ id, kind: 'tacocat' }))
    const pending: Pending = { player: 1, cards: tacocats, effect: 'triple', target: 0, named: 'defuse' }
    expect(line({ t: 'played', pending, at: 0 })).toBe('Bob played three {tacocat|Tacocats} on you for a {defuse}')
    const nope: Card = { id: 9, kind: 'nope' }
    expect(line({ t: 'noped', player: 2, card: nope, stops: { player: 1, cards: tacocats } })).toBe(
      'Frank {nope|noped} Bob’s {tacocat|Tacocats}',
    )
    expect(line({ t: 'noped', player: 0, card: nope, stops: { player: 2, cards: [nope] } })).toBe('You {nope|noped} Frank’s {nope}')
    expect(line({ t: 'moved', from: 1, to: 0, card: { id: 2, kind: 'skip' }, via: 'favor' })).toBe('Bob gave you a {skip}')
    expect(line({ t: 'moved', from: 1, to: 2, card: null, via: 'pair' })).toBe('Frank took a card from Bob')
    expect(line({ t: 'missed', player: 0, target: 2, named: 'defuse' })).toBe('Frank had no {defuse}')
    expect(line({ t: 'out', player: 1, why: 'time', hand: [], kitten: null })).toBe('Bob ran out of time')
    expect(line({ t: 'saw', player: 1, cards: [] })).toBeUndefined() // someone else's peek
  })

  it('reads a card aloud, and says how to use it', () => {
    expect(label({ card: { kind: 'skip' }, up: false, count: 1, kittens: 1 }, false)).toBe('Deck, 1 card, 1 Ekitten')
    expect(label({ card: { kind: 'hairy-potato-cat' }, up: true, count: 3, asks: 'defuse' }, false)).toBe('3 Potatoes, any Defuse?')
    expect(label({ card: { kind: 'nope' }, up: true }, true)).toBe('Discard pile: Nope')
    // A tap lifts a hand card first, but opens the log at once; the deck's rule already says draw.
    expect([hint('hand', 'touch'), hint('pile', 'touch'), hint('deck', 'mouse')]).toEqual([
      'Tap again to play.',
      'Tap to see what happened.',
      null,
    ])
  })
})
