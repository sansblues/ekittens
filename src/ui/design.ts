import { Clock } from '../room'

// Motion, depth and sizes that code computes with, the type scale among them. Color, space and corners live in
// styles.css.

/** Interruptible, and they keep their velocity. Only a card thrown bounces: nothing else carried momentum. */
export const Spring = {
  /** A card going somewhere. */
  move: { type: 'spring', visualDuration: 0.5, bounce: 0 },
  /** A card leaving or reaching a bot's avatar: slower, so you see what they did. */
  cue: { type: 'spring', visualDuration: 0.75, bounce: 0 },
  /** What answers you at once: a card lifted or picked up, a sheet, the pill, a seat taken, the sun. */
  quick: { type: 'spring', visualDuration: 0.25, bounce: 0 },
  /** A card flung onto the pile. */
  thrown: { type: 'spring', visualDuration: 0.5, bounce: 0.25 },
  /** The logo's eyes after your pointer: soft, so they follow rather than snap. */
  follow: { type: 'spring', visualDuration: 0.4, bounce: 0 },
} as const

/** The one curve that eases out what arrives or leaves, in CSS (--ease-out) and in Motion. */
const EaseOut = [0.23, 1, 0.32, 1] as const

/** A fade, or any tween, `duration` seconds long after `delay`, on that curve. */
export const tween = (duration: number, delay = 0) => ({ duration, delay, ease: EaseOut })

/** A card leaving a bot's avatar shows there `wait` first; one arriving melts in after `melt`. Your own moves don't wait. */
export const Cue = { wait: 0.25, melt: 0.5 } as const

export const Time = {
  /** What arrives. */
  fade: 0.25,
  /** What may pass at once ("Connecting…") is said only once it has lasted this long. */
  late: 1,
  /** A new sheet's contents are in, so its button can take the focus. */
  mount: 0.05,
  /** What leaves, and quick feedback. */
  micro: 0.125,
  flinch: 0.25,
  /** A sheet the game raised takes no press this soon: it was meant for what was there before (kit.tsx: useFresh). */
  fresh: 0.4,
  /** What a tap brings up stays this long: a tip where a mouse would rest, or a "Copied". */
  told: 2,
  /** The first screen settles in over `enter`, each part `step` after the one before; it waits for its
   *  pictures at most `ready`, so none pops in after its own fade. */
  enter: 0.4,
  step: 0.06,
  ready: 0.8,
  /** A tip shows once the pointer has rested this long, and at once for this long after one has. */
  rest: 0.5,
  /** A drawn card is clear of the deck: only then do the piles step aside. */
  clear: 0.25,
  /** One card of your opening hand leaves the deck per step: the deal sound's rhythm. */
  dealStep: 0.0625,
  /** When a card visibly lands: a spring is 90% there at three quarters of its visual duration. */
  land: 0.75 * Spring.move.visualDuration,
  cueLand: Cue.wait + 0.75 * Spring.cue.visualDuration,
} as const

/** The final seconds worth emphasizing on the clock and sounding aloud. */
export const Hurry = { show: 10, tick: 5 } as const

/** How long each moment holds the table. */
export const Hold = {
  travel: 0.5,
  suspense: 0.5,
  reveal: 0.5,
  kitten: 1.75,
  doomed: 0.75, // your kitten, with no Defuse: straight to the boom
  settle: 0.75,
  pass: 1.5,
  home: 0.75,
  resolve: 0.5, // a Shuffle takes three: it drops, the deck parts, then closes
  defuse: 1.5,
  place: 1,
  missed: 1.25,
  boom: 2, // a bot's; your own takes half, then the end
  out: 1.5, // someone leaves: a kitten leaves the deck with them
  read: 0.75, // a step of how to play, still once it has settled, to be taken in
} as const

/** Cross-fading text blurs a touch, so it reads as one thing changing. */
export const Blur = 'blur(4px)'

/** A thing pressed gives under the finger: a wide button by less, or its edges would lurch. */
export const Press = { scale: 0.97, wide: 0.985, transition: tween(Time.micro) } as const

export const Instant = { duration: 0 } as const

export const Slam = { scale: 1.1, duration: 0.5, peak: 0.25 } as const

/** The slam's keyframes: fast up to its peak, then settling back. */
export const SlamTiming = {
  duration: Slam.duration,
  times: [0, Slam.peak / Slam.duration, 1],
  ease: ['easeOut', 'easeInOut'] as ('easeOut' | 'easeInOut')[],
}

/** Seconds: the logo's cat blinks every `every` to `every + give`, its eyes shut for `shut`. */
export const Blink = { every: 4, give: 3, shut: 0.14 } as const

/** The dim as a kitten slams: `depth` is its opacity at the slam's peak. */
export const Flush = { kitten: { depth: 0.25, duration: 0.75 }, boom: { depth: 0.5, duration: 1.25 } } as const

/** Back to front. */
export const Depth = {
  seat: 10, // the bots' cards, inside their avatars
  deck: 100,
  discard: 200,
  hand: 600,
  lifted: 900,
  stage: 1000,
  dim: 1400,
  context: 1440, // the play behind the moment
  moment: 1500,
  dragged: 3000,
} as const

/** A card's height per unit of width (5:7). */
export const Ratio = 1.4

/** The type scale (px), each a role. `caption` is the smallest text anywhere: below it, a card shows its emblem
 *  alone. On a compact table, its text takes the next step down. */
export const Text = { title: 28, lead: 20, body: 17, small: 14, caption: 12 } as const

/** A card's name: this share of its width, never under a caption. */
export const NameSize = 0.115

/** The narrowest card (px) whose longest name, "Rainbow", fits at a caption; narrower ones show their emblem alone. */
export const NamedWidth = 84

/** The turn's sun reaches this share of its avatar past each side. */
export const Rays = 0.275

/** px: the room kept between the screen's edges and anything on it. */
export const Gutter = 16

/** px: a card's width as drawn: in your hand and on the stage (the table then scales both), and in a sheet,
 *  where its name is a caption. */
export const CardWidth = { hand: 108, stage: 150, sheet: 96 } as const

/** A deck's edges under its top card: one for each `per` cards below it, `most` at most (a full deck), each
 *  `step` px lower on a card of stage width. */
export const Edges = { per: 8, most: 4, step: 3.5 } as const

/** px: a face, by where it shows: in a line of text, on a button, at a seat, crowned the winner. */
export const Face = { line: 24, option: 40, seat: 52, crown: 64 } as const

/** px */
export const Sheet = { width: 588, pad: 24 } as const

/** px */
export const TipWidth = 236

/** Written onto :root at start (main.tsx), so styles.css shares these values instead of repeating them. */
export const CssVars = {
  '--fade': `${Time.fade}s`,
  '--enter': `${Time.enter}s`,
  '--step': `${Time.step}s`,
  '--micro': `${Time.micro}s`,
  '--window': `${Clock.window}s`,
  '--suspense': `${Hold.suspense}s`,
  '--ease-out': `cubic-bezier(${EaseOut.join(', ')})`,
  '--blink': `${Blink.shut / 2}s`, // a lid closes in half a blink, and opens in the other
  '--press': `${Press.scale}`,
  '--press-wide': `${Press.wide}`,
  '--ratio': `${Ratio}`,
  '--name': `${NameSize}`,
  ...Object.fromEntries(Object.entries(Text).map(([role, px]) => [`--text-${role}`, `${px}px`])),
  '--rays': `${Rays}`,
  '--gutter': `${Gutter}px`,
  '--card-sheet': `${CardWidth.sheet}px`,
  '--face-option': `${Face.option}px`,
  '--face-seat': `${Face.seat}px`,
  '--sheet-width': `${Sheet.width}px`,
  '--sheet-pad': `${Sheet.pad}px`,
  '--tip-width': `${TipWidth}px`,
}
