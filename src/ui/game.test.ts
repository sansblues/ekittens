import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, setup, view, type Action, type State } from '../engine'
import { Version } from '../room'
import { Game } from './game'
import { sheet, shownDeck } from './table'

// Storage and time without a browser or audio device.
const stored = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./browser', () => ({
  load: (key: string) => stored.get(key),
  save: (key: string, value: unknown) => stored.set(key, value),
  forget: (key: string) => stored.delete(key),
  now: () => 0,
  after: (s: number, fn: () => void) => {
    const timer = setTimeout(fn, s * 1000)
    return () => clearTimeout(timer)
  },
  listen: () => () => {},
}))
vi.mock('./sound', () => ({ atDeck: () => ({}), playEvent: () => {}, sfx: () => {} }))

/** A screen at seat 0 of `state`, a table of two people, its deal already shown. */
function seated(state: State, act: (action: Action) => void = () => {}): Game {
  vi.useFakeTimers()
  vi.stubGlobal('document', { hidden: false })
  const cast = [
    { face: 0, name: '', bot: false },
    { face: 1, name: '', bot: false },
  ]
  const game = new Game({ join: () => () => {}, act, done: () => {} }, { t: 'table', deal: 1, cast, view: view(state, 0), events: [] })
  game.subscribe(() => {})
  vi.runAllTimers()
  return game
}

/** A real save, as `Game.start` writes it. */
function saved(): object {
  Game.start(0, [1])
  return Object(stored.get('game'))
}

describe('game', () => {
  beforeEach(() => stored.clear())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('picks a saved game up again', () => {
    stored.set('game', saved())

    expect(Game.resume()).toBeInstanceOf(Game)
  })

  it.each([
    ['cut short', () => ({ v: Version })],
    ['missing its events', () => ({ ...saved(), events: undefined })],
    ['with a character that is gone', () => ({ ...saved(), cast: [0, 99] })],
  ])('drops a save %s instead of crashing every load', (_, broken) => {
    stored.set('game', broken())

    expect(Game.resume()).toBeNull()
    expect(stored.has('game')).toBe(false)
  })

  it('sends a double tap once, whatever else the room says before it answers', () => {
    const acts: Action[] = []
    const game = seated(setup(2, 1), (action) => acts.push(action))
    const deck = shownDeck(game.snap).cards[0]!
    game.make(deck)
    game.hear({ t: 'clock', seat: 0, left: 30 })
    game.setOffline(false) // said on every lobby the room tells
    game.make(deck)
    expect(acts).toHaveLength(1)
    game.dispose()
  })

  it.each([true, false])('shows elimination when Peek is open or queued (%s)', (open) => {
    const state = setup(2, 1)
    state.players[0]!.hand.push({ id: 900, kind: 'see-the-future' })
    const game = seated(state)
    const played = apply(state, { t: 'play', player: 0, cards: [900] })
    if (played.state.phase.t !== 'window') throw new Error('no Nope window')
    const peek = apply(played.state, { t: 'expire', id: played.state.phase.id })
    game.hear({ t: 'moved', view: view(played.state, 0), events: played.events })
    game.hear({ t: 'moved', view: view(peek.state, 0), events: peek.events })
    if (open) {
      vi.runAllTimers()
      expect(sheet(game.snap)).toBe('future')
    }
    const out = apply(peek.state, { t: 'out', player: 0, why: 'time' })
    game.hear({ t: 'moved', view: view(out.state, 0), events: out.events })
    vi.runAllTimers()
    expect(sheet(game.snap)).toBe('end')
    expect(game.snap.log.at(-1)?.text).toBe('You ran out of time')
    game.dispose()
  })
})
