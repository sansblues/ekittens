import { describe, expect, it } from 'vitest'
import { NameLength, arrive, asCode, leave, nameFor, parse, pickBots, seats, type Lobby } from './lobby'

const key = (n: number) => `key-${n}`.padEnd(16, '-')

/** The faces at the table: the people's, then the bots'. */
const faces = (l: Lobby) => [l.people.map((p) => p.face), l.bots]

describe('lobby', () => {
  it('seats each person at their own face if free, else a free one, else a bot’s, in turn; past five, nobody', () => {
    let l: Lobby = { people: [], bots: [1, 2] }
    l = arrive(l, key(0), 'Ann', 0)
    l = arrive(l, key(1), '', 0) // taken by a person: a free one, and with no name, its name
    expect(faces(l)).toEqual([
      [0, 3],
      [1, 2],
    ])
    expect(l.people.map((p) => p.name)).toEqual(['Ann', 'Rose'])
    l = arrive(l, key(2), '', 1) // a bot's: still a free one, and the bot stays
    expect(faces(l)).toEqual([
      [0, 3, 4],
      [1, 2],
    ])
    expect(seats(l)).toEqual([0, 3, 4, 1, 2]) // the people first, then the bots, however they came
    l = arrive(l, key(3), '', 4) // none free: the last bot's
    expect(seats(l)).toEqual([0, 3, 4, 2, 1])
    l = arrive(l, key(4), '', 0)
    expect(faces(l)).toEqual([[0, 3, 4, 2, 1], []])
    expect(seats(leave(l, key(1)))).toEqual([0, 4, 2, 1]) // one gone leaves no gap
    expect(arrive(l, key(5), '', 0)).toBe(l) // no sixth
    expect(arrive(l, key(0), 'Bo', 2)).toBe(l) // a second tab keeps the seat
    // Bots wear no person's face, and sit after the people in the order asked.
    expect(seats(pickBots({ people: l.people.slice(0, 2), bots: [] }, [4, 0, 1, 3]))).toEqual([0, 3, 4, 1])
  })

  it('keeps a name to one line of what shows, and never cuts a character in two', () => {
    expect(nameFor('  {Ann}\u0000\u202E \n  Lee  ', 0)).toBe('Ann Lee')
    const full = 'Ann Lee-Smith-Jones'
    expect(nameFor(full, 0)).toBe(full.slice(0, NameLength))
    // An emoji family and an accented letter count as one each, however many code points they take.
    expect(nameFor('👩‍👩‍👧'.repeat(NameLength + 1), 0)).toBe('👩‍👩‍👧'.repeat(NameLength))
    expect(nameFor('é'.normalize('NFD').repeat(NameLength + 1), 0)).toBe('é'.repeat(NameLength))
    expect(nameFor(' \u200B{}', 1)).toBe('Bob')
  })

  it('reads a code however it was typed, and nothing else as one', () => {
    expect(asCode('k7ol')).toBe('K701')
    expect(['K7QU', 'K70', 'K7011'].map(asCode)).toEqual([null, null, null]) // no U; four, no more or fewer
  })

  it('drops any message from a screen that does not hold together', () => {
    const hello = { t: 'hello', key: key(0), name: 'Ann', face: 2, release: 'r1' }
    expect(parse(JSON.stringify(hello))).toEqual(hello)
    const play = { t: 'act', deal: 42, action: { t: 'play', player: 0, cards: [3, 4], target: 1 } }
    expect(parse(JSON.stringify(play))).toEqual(play)
    for (const bad of [
      'not json',
      '[]',
      { t: 'shout' },
      { ...hello, key: 'short' },
      { ...hello, face: 9 },
      { ...hello, name: undefined },
      { t: 'bots', faces: [0, 'x'] },
      { ...play, deal: undefined },
      { t: 'done', seen: 0 },
      { t: 'act', deal: 42, action: { t: 'play', player: 0, cards: 'all' } },
      { t: 'act', deal: 42, action: { t: 'play', player: 0, cards: [1, 2, 3, 4] } },
      { t: 'act', deal: 42, action: { t: 'expire', id: 0 } }, // the room's alone
      { t: 'act', deal: 42, action: { t: 'out', player: 0, why: 'time' } }, // so is the clock
      { t: 'act', deal: 42, action: { t: 'nope', player: 0.5, card: 1, id: 0 } },
    ])
      expect(parse(typeof bad === 'string' ? bad : JSON.stringify(bad)), JSON.stringify(bad)).toBeNull()
  })
})
