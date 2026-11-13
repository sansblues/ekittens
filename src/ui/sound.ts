import type { Event, PlayerId, View } from '../engine'
import { listen, load, save, still } from './browser'
import { Cue, Time } from './design'
import { isMe, others } from './table'

// Real card foley (Kenney's Casino Audio, CC0, prepared by scripts/sounds.mjs), and for the moments
// that mean something a soft wooden mallet in D major pentatonic, so any two notes sound well together.

/** Where a sound happens: left to right (-0.5 to 0.5), across the table (softer and duller), any further trim (dB). */
interface Where {
  pan?: number
  far?: boolean
  db?: number
}

/** At the deck, left of center; `far` when someone else draws. */
export const atDeck = (far = false): Where => ({ pan: -0.15, ...(far && { far: true, db: -3 }) })

/** Each sound's level above the everyday card sounds (dB): the rarer and the more it matters, the louder.
 *  Every voice is first calibrated to the same loudness (K-weighted, roughly as in BS.1770). */
const Level = {
  slide: 0, // a card leaves: drawn, played, given, slid into the deck
  place: 0, // a card lands on another: a Defuse onto its kitten
  turn: 0, // your turn: two notes, up
  join: 0, // someone sits down at your table: a doorbell, two notes, down
  nope: 3, // a Nope slaps down: a heavier landing
  deal: 3,
  shuffle: 3,
  alert: 3, // a play that costs you: a knock, twice
  tick: 0, // your move's clock, each of its last seconds: one short, high knock
  defuse: 3, // the kitten defused: its low note resolves
  kitten: 4, // an Ekitten is revealed: one low, unresolved note
  boom: 6,
  win: 6,
  lose: 6,
}

type Sound = keyof typeof Level

/** Every sound, to listen to on sounds.html. */
export const Sounds = Object.keys(Level) as Sound[]

/** The card sounds are leveled at -28 LUFS, so they play at about -35: present, never loud. */
const BaseDb = -7

/** What a hidden tab still hears: only what calls you back. */
const Calls: ReadonlySet<Sound> = new Set(['turn', 'join', 'alert', 'tick', 'win', 'lose'])

/** Across the table: this much softer (dB), and nothing above this (Hz). */
const Far = { db: -3, hz: 3500 }

const Takes = {
  slide: ['slide-1', 'slide-2', 'slide-3', 'slide-4'],
  place: ['place-1', 'place-2', 'place-3', 'place-4'],
  deal: ['deal'],
  shuffle: ['shuffle-1', 'shuffle-2'],
}

/** The sound of each event's card: setting off (a slide) or landing on another. A play resolving onto the pile is silent. */
const Moves: Partial<Record<Event['t'], Sound>> = { played: 'slide', noped: 'nope', defused: 'place', moved: 'slide', placed: 'slide' }

/** Who moves the card an event sounds for; null for a kitten slid into the deck, which counts as yours: it never waits on a cue. */
const mover = (e: Event): PlayerId | null =>
  e.t === 'played' ? e.pending.player : e.t === 'noped' || e.t === 'defused' ? e.player : e.t === 'moved' ? e.from : null

/** Across the table, panned to their place on the arc. */
function seat(view: View, id: PlayerId): Where {
  const arc = others(view)
  return { pan: arc.length > 1 ? arc.indexOf(id) / (arc.length - 1) - 0.5 : 0, far: true }
}

/** Plays an event's sound on the frame its card moves, from where it happens. A card leaving a bot's
 *  avatar shows there first; a landing waits for its card, unless you dropped it right there. */
export function playEvent(e: Event, view: View, inPlace: boolean) {
  const sound = Moves[e.t]
  if (!sound) return
  const who = mover(e)
  const yours = who === null || isMe(view, who)
  const lands = sound !== 'slide'
  const delay = yours ? (lands && !inPlace ? Time.land : 0) : lands ? Time.cueLand : Cue.wait
  sfx(sound, delay, e.t === 'placed' ? atDeck() : lands || yours ? {} : seat(view, who))
  if (e.t === 'defused') sfx('defuse', delay) // the kitten's low note resolves as the Defuse lands
}

let muted = load('mute') === true

export const isMuted = () => muted

export function setMuted(m: boolean) {
  muted = m
  save('mute', m)
}

let ctx: AudioContext | null = null
let out: AudioNode | null = null

/** Browsers let a page make sound only after a touch, and iPhone only from inside it: start (or resume) on a press. */
function wake() {
  if (!ctx) {
    // iPhone: obey the silent switch, and play alongside your music.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) session.type = 'ambient'
    ctx = new AudioContext({ latencyHint: 'interactive' })
    // A limiter last, so sounds that land together never clip.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.002
    limiter.release.value = 0.1
    limiter.connect(ctx.destination)
    out = limiter
  }
  if (ctx.state !== 'running') void ctx.resume()
}

// A touch's press doesn't count as one for audio on every phone: its release does.
listen(window, 'pointerdown', wake, true)
listen(window, 'pointerup', wake, true)
listen(window, 'keydown', wake, true)

/** The takes, decoded up front, so the first sound is never late. */
const buffers = new Map<string, AudioBuffer>()
const decoder = new OfflineAudioContext(1, 1, 44100)
const decode = async (name: string) => {
  const file = await fetch(`/sounds/${name}.wav`)
  buffers.set(name, await decoder.decodeAudioData(await file.arrayBuffer()))
}
// A take that fails to load stays silent, and its error shows in the console.
for (const name of Object.values(Takes).flat()) void decode(name)

/** Plays a sound `delay` seconds from now, on the audio clock. With reduced motion nothing travels, so nothing waits. */
export function sfx(sound: Sound, delay = 0, where: Where = {}) {
  // A suspended clock stands still: sounds queued on it would all fire at once on resume.
  if (muted || !out || ctx?.state !== 'running') return
  if (document.hidden && !Calls.has(sound)) return
  const t = ctx.currentTime + 0.005 + (still() ? 0 : delay)
  const level = ctx.createGain()
  level.gain.value = 10 ** ((BaseDb + Level[sound] + (where.far ? Far.db : 0) + (where.db ?? 0)) / 20)
  const pan = ctx.createStereoPanner()
  pan.pan.value = where.pan ?? 0
  level.connect(pan)
  if (where.far) {
    const dull = ctx.createBiquadFilter()
    dull.type = 'lowpass'
    dull.frequency.value = Far.hz
    pan.connect(dull).connect(out)
  } else pan.connect(out)
  synth(ctx, level, sound, t)
}

/** The last take each sound played, so the next is another. */
const last = new Map<string, string>()

function synth(a: BaseAudioContext, dest: AudioNode, sound: Sound, t: number) {
  switch (sound) {
    case 'slide':
    case 'place':
    case 'deal':
    case 'shuffle':
      return take(a, dest, t, Takes[sound])
    case 'nope':
      return take(a, dest, t, Takes.place, 0.9) // the same card, landing heavier: lower
    case 'boom':
      return boom(a, dest, t)
    case 'turn':
      return melody(a, dest, t, [A4, D5], 0.09)
    case 'join':
      return melody(a, dest, t, [Fs5, D5], 0.18, { decay: 0.6, gain: 1.03 })
    case 'alert':
      return melody(a, dest, t, [E5, E5], 0.11, { bright: 0.6, decay: 0.25, gain: 1.34 })
    case 'tick':
      return melody(a, dest, t, [A5], 0, { bright: 0.6, decay: 0.08, body: 0, gain: 1.2 })
    case 'kitten':
      return melody(a, dest, t, [B3], 0, { decay: 0.9, bright: 0, body: 0.5, gain: 0.96 })
    case 'defuse':
      return melody(a, dest, t, [D4, A4], 0.08, { body: 0.4, gain: 0.98 })
    case 'win':
      return melody(a, dest, t, [D5, Fs5, A5, D6], 0.07, { last: 0.8, gain: 0.74 })
    case 'lose':
      return melody(a, dest, t, [A4, Fs4, D4], 0.12, { last: 0.8, bright: 0.1, gain: 0.91 })
  }
}

/** One of a sound's takes (never the last one played), a quarter tone higher or lower at most. */
function take(a: BaseAudioContext, dest: AudioNode, t: number, names: string[], rate = 1) {
  const key = names[0]!
  const pool = names.length > 1 ? names.filter((n) => n !== last.get(key)) : names
  const name = pool[Math.floor(Math.random() * pool.length)]!
  const buffer = buffers.get(name)
  if (!buffer) return
  last.set(key, name)
  const src = a.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = rate * 2 ** ((Math.random() - 0.5) / 12)
  src.connect(dest)
  src.start(t)
}

// D major pentatonic, from B3 (just below middle C) to D6.
const note = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const B3 = note(59)
const D4 = note(62)
const Fs4 = note(66)
const A4 = note(69)
const D5 = note(74)
const E5 = note(76)
const Fs5 = note(78)
const A5 = note(81)
const D6 = note(86)

interface Mallet {
  /** How long the note rings (s). */
  decay?: number
  /** How long a figure's last note rings (s). */
  last?: number
  /** The strike's click (the 4th partial): wood under a soft mallet. */
  bright?: number
  /** The octave above (warmth, and what a phone's small speaker can play of a low note). */
  body?: number
  /** A figure's own trim, measured to sit on the ladder: a quick, bright pair reads quieter, a long, low note louder. */
  gain?: number
}

/** A short figure on the mallet: one note every `step` seconds. */
function melody(a: BaseAudioContext, dest: AudioNode, t: number, notes: number[], step: number, m: Mallet = {}) {
  notes.forEach((f, i) => mallet(a, dest, t + i * step, f, { ...m, decay: i === notes.length - 1 ? (m.last ?? m.decay) : m.decay }))
}

/** Measured (K-weighted, as heard), so a figure sits on the same ladder as a card (see Level). */
const MalletGain = 0.109

/** The note, its octave fading sooner, and a brief strike; a 4 ms attack, so it never clicks. */
function mallet(a: BaseAudioContext, dest: AudioNode, t: number, f: number, { decay = 0.45, bright = 0.3, body = 0.25, gain = 1 }: Mallet) {
  const partials: [number, number, number][] = [
    [1, 1, decay],
    [2, body, decay * 0.4],
    [4, bright * 0.15, 0.06],
  ]
  for (const [ratio, amp, d] of partials) {
    if (amp <= 0) continue
    const o = a.createOscillator()
    o.frequency.value = f * ratio
    const g = a.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(amp * MalletGain * gain, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + d)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + d + 0.05)
  }
}

/** A dull rush of air over a low thump: the rush carries it on a phone, whose speaker plays little below 300 Hz. */
function boom(a: BaseAudioContext, dest: AudioNode, t: number) {
  const o = a.createOscillator()
  o.frequency.setValueAtTime(110, t)
  o.frequency.exponentialRampToValueAtTime(40, t + 0.5)
  const g = a.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.072, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
  o.connect(g).connect(dest)
  o.start(t)
  o.stop(t + 0.75)
  const len = Math.ceil(a.sampleRate * 0.5)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  const air = a.createBufferSource()
  air.buffer = buf
  const lp = a.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(1500, t)
  lp.frequency.exponentialRampToValueAtTime(250, t + 0.45)
  const ag = a.createGain()
  ag.gain.setValueAtTime(0, t)
  ag.gain.linearRampToValueAtTime(0.3, t + 0.005)
  air.connect(lp).connect(ag).connect(dest)
  air.start(t)
}
