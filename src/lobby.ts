import { Kinds, type Action } from './engine'
import type { Told } from './room'

// Who sits at a room with friends between games, and what its screens and the room say to each other.
// The faces are the seats: each person or bot wears one, so five at most play.

/** Each `key` is a face drawn by scripts/avatars.mjs, as public/avatars/{key}.svg: rename both together. */
export const Characters = [
  { key: 'dude', name: 'Leo' },
  { key: 'blob', name: 'Bob' },
  { key: 'corndog', name: 'Frank' },
  { key: 'granny', name: 'Rose' },
  { key: 'alien', name: 'Gary' },
] as const

const Faces = Characters.map((_, face) => face)

declare const __RELEASE__: string

/** This build, set as it's made (vite.config.ts): a screen of another release is out of date with the room. */
export const Release = __RELEASE__

/** The code a room closes a screen of another release with. */
export const Outdated = 4010

/** The code a screen closes its line with as it leaves the room for good; any other close may be a reload or a drop. */
export const Left = 4001

/** Every face, from the one after `face` round to it: the order a table fills from yours. */
export const facesAfter = (face: number) => Faces.map((i) => (face + 1 + i) % Faces.length)

// A room's code, in its link: four of Crockford's Base32, in capitals. It has no I, L, O or U, so one read aloud
// or retyped can't be mistaken (nor spell a word). A million codes, against the few rooms a day keeps: enough
// for a screen to pick its own (and share the link at once, as a phone requires), and the server refuses one
// already taken.
const Letters = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CodeLength = 4
const Code = new RegExp(`^[${Letters}]{${CodeLength}}$`)
export const newCode = () => Array.from({ length: CodeLength }, () => Letters[Math.floor(Math.random() * Letters.length)]).join('')

/** A code as typed, as it's written, or null if it isn't one: any case, an O read as 0, an I or L as 1. */
export const asCode = (typed: string) => {
  const code = typed.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
  return Code.test(code) ? code : null
}

/** The most a name may hold, in characters as you see them. Where a name meets less room, it fades. */
export const NameLength = 12

/** What a name may not hold: controls, what turns text around, and what shows nothing at all. */
const Hostile =
  /[\0-\x08\x0E-\x1F\x7F-\x9F\u00AD\u061C\u115F\u1160\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g

/** The most marks one character may stack: real writing stacks up to five (Burmese), and more scrawls over the line. */
const Marks = 6

/** A name's characters as you see them (an emoji, an accented letter), with nothing hostile and none over-marked. */
export const characters = (name: string) =>
  Array.from(new Intl.Segmenter().segment(name.normalize('NFC').replace(Hostile, '')), ({ segment }) => {
    let marks = 0
    return [...segment].filter((c) => !/\p{M}/u.test(c) || ++marks <= Marks).join('')
  })

/** A name as it's typed: never more than `NameLength`, and never cut inside a character. */
export const clip = (name: string) => characters(name).slice(0, NameLength).join('')

/** A name on one line, without braces (in the game's lines they mark a card); with none, the face's own. */
export const nameFor = (name: string, face: number) =>
  clip(name.replace(Hostile, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()).trim() || Characters[face]!.name

/** `key` is a person's secret: it takes their seat back, so no screen hears another's. */
interface Person {
  key: string
  name: string
  face: number
}

/** The people here, in the order they came, and the faces the bots wear, in the order they were added. */
export interface Lobby {
  people: Person[]
  bots: number[]
}

type Worn = { people: { face: number }[]; bots: number[] }

/** Every seat's face, as the lobby shows them: the people first, then the bots. */
export const seats = ({ people, bots }: Worn) => [...people.map((p) => p.face), ...bots]

/** The faces nobody at the table wears, person or bot. */
export const freeFaces = ({ people, bots }: Worn) => Faces.filter((f) => !people.some((p) => p.face === f) && !bots.includes(f))

/** The face one coming in sits at: their own if nobody wears it, else a free one, else the last bot's. None:
 *  five people are here. */
export function faceAt(table: Worn, face: number): number | undefined {
  const free = freeFaces(table)
  return free.includes(face) ? face : (free[0] ?? table.bots.at(-1))
}

/** A person comes in, at the face `faceAt` gives them, taking a bot's place if it's a bot's. Past five, nobody
 *  new does. One already here (a second tab) just keeps their seat. */
export function arrive(lobby: Lobby, key: string, name: string, face: number): Lobby {
  if (lobby.people.some((p) => p.key === key)) return lobby
  const pick = faceAt(lobby, face)
  if (pick === undefined) return lobby
  return { people: [...lobby.people, { key, name: nameFor(name, pick), face: pick }], bots: lobby.bots.filter((f) => f !== pick) }
}

export const leave = (lobby: Lobby, key: string): Lobby => ({ ...lobby, people: lobby.people.filter((p) => p.key !== key) })

/** Bots wear only faces no person does, in the order asked. */
export const pickBots = (lobby: Lobby, faces: number[]): Lobby => ({
  ...lobby,
  bots: faces.filter((f, i) => isFace(f) && faces.indexOf(f) === i && !lobby.people.some((p) => p.face === f)),
})

/** Who sits where, as a friend's link sees it before joining: names and faces, never a key. */
export interface Table {
  people: { name: string; face: number }[]
  bots: number[]
  /** A game is on: one joining now watches it, and plays the next. */
  playing: boolean
}

/** At least two at the table, people and bots: enough for a game. */
export const canPlay = (lobby: Worn) => lobby.people.length + lobby.bots.length >= 2

/** What a screen sends the room. */
export type ToRoom =
  /** First, on every connection: who this is, the name and face they'd like, the release they run, and the game
   *  this screen still shows, if any. */
  | { t: 'hello'; key: string; name: string; face: number; release: string; deal?: number }
  /** Or, from a friend's link before joining: only looking, to hear who's here and watch any game on. */
  | { t: 'look'; release: string }
  | { t: 'bots'; faces: number[] }
  | { t: 'play' }
  | { t: 'act'; deal: number; action: Action }
  /** Every move up to the `seen`th event has been shown. */
  | { t: 'done'; deal: number; seen: number }

/** What the room sends a screen: the lobby, the game, or that there's no such room. */
export type ToScreen =
  Told | { t: 'lobby'; people: { name: string; face: number; you: boolean }[]; bots: number[]; playing: boolean } | { t: 'gone' }

/** A screen's message, if it holds together; anything else is dropped before the room sees it. */
export function parse(text: string): ToRoom | null {
  let m: unknown
  try {
    m = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(m)) return null
  switch (m.t) {
    case 'hello':
      return typeof m.key === 'string' && m.key.length >= 16 && m.key.length <= 64 && typeof m.name === 'string' && isFace(m.face)
        ? { t: 'hello', key: m.key, name: m.name, face: m.face, release: release(m), ...(isInt(m.deal) && { deal: m.deal }) }
        : null
    case 'bots':
      return Array.isArray(m.faces) && m.faces.every(isFace) ? { t: 'bots', faces: m.faces } : null
    case 'look':
      return { t: 'look', release: release(m) }
    case 'play':
      return { t: m.t }
    case 'done':
      return isInt(m.deal) && isInt(m.seen) ? { t: 'done', deal: m.deal, seen: m.seen } : null
    case 'act':
      return isInt(m.deal) && isAction(m.action) ? { t: 'act', deal: m.deal, action: m.action } : null
    default:
      return null
  }
}

const release = (m: Record<string, unknown>) => (typeof m.release === 'string' ? m.release : '')
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFace = (v: unknown): v is number => Faces.includes(v as number)
const isInt = (v: unknown): v is number => Number.isInteger(v)

/** Shaped like a move, so the rules can judge it without tripping: whether it's legal is theirs to say. */
function isAction(a: unknown): a is Action {
  if (!isRecord(a) || !isInt(a.player)) return false
  switch (a.t) {
    case 'play':
      return (
        Array.isArray(a.cards) &&
        a.cards.length <= 3 &&
        a.cards.every(isInt) &&
        (a.target === undefined || isInt(a.target)) &&
        (a.named === undefined || Kinds.includes(a.named as never))
      )
    case 'nope':
      return isInt(a.card) && isInt(a.id)
    case 'draw':
      return true
    case 'defuse':
    case 'give':
      return isInt(a.card)
    case 'place':
    case 'pick':
      return isInt(a.index)
    case 'out':
      return a.why === 'left'
    default:
      return false
  }
}
