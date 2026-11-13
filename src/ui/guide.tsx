import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Variants } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Kind } from '../engine'
import { Characters } from '../lobby'
import { Avatar } from './avatar'
import { after } from './browser'
import { Card, Named } from './card'
import { CardWidth, Edges, Face, Hold, Slam, SlamTiming, Spring, Time, tween } from './design'

// How to play: the game's rules in five lines, and over them a game in progress where the lit one plays out
// as it does at the table, with its cards, faces, places and timing. Once the page has settled in, it plays
// through once, then rests on the first; a pointer resting on it, or a key in it, pauses it. Going to a line
// (a tap, the arrow keys or a swipe on the scene) stops it there: you're reading.

/** The danger first, then what saves you, then why you'd play cards at all. A card's name with its emblem, as
 *  the game writes it (`{kind}`, see words.ts). */
const Steps = [
  'Draw a card to end your turn',
  'If it’s an {exploding-kitten}, you lose',
  'Unless you have a {defuse}',
  'Play cards first to stay safe',
  'The last one left wins',
]

const Width = CardWidth.sheet

/** px from the deck, as on the table: the stage between the piles, where a card is played or drawn, and the
 *  discard pile beyond it. */
const Stage = Width * 0.72
const Discard = Width * 1.44

/** px down: your hand, where a played card comes from and a drawn one goes; and a Defuse slapped onto the
 *  Ekitten, low enough that the Ekitten keeps its name in view. */
const Hand = Width * 0.6
const Slap = Width * 0.29

/** Seconds into a scene, as the game times a draw: the card leaves the deck, trembles face down, turns over, is
 *  shown a beat longer than the game shows yours (so it can be read), then goes to your hand. A card played, or
 *  the Ekitten hidden again, waits on the stage as long, then goes to its pile. */
const Leave = Time.fade
const Suspense = Leave + Hold.travel
const Reveal = Suspense + Hold.suspense
const Home = Reveal + 2 * Hold.reveal
const Lands = Reveal + Hold.resolve

/** Seconds into each step while the stage is busy and the piles step aside, as at the table: one thing at a
 *  time. A drawn card clears the deck first; the Ekitten keeps the stage until it's hidden; the game over,
 *  the table clears. */
const Busy: [number, number][] = [
  [Leave + Time.clear, Home + Time.fade],
  [Leave + Time.clear, Infinity],
  [0, Lands],
  [0, Lands],
  [0, Infinity],
]

/** The deck's edges as each step starts, and once its stage is clear again: a draw takes one, the Ekitten hidden
 *  puts one back. One card is thinner than an edge, but a deck that comes back as it left says nothing was taken. */
const Deck: [number, number][] = [
  [Edges.most, Edges.most - 1],
  [Edges.most - 1, Edges.most - 2],
  [Edges.most - 2, Edges.most - 1],
  [Edges.most - 1, Edges.most - 1],
  [Edges.most - 1, Edges.most - 1],
]

/** px a swipe must travel, or px/s it must move at, to step. */
const Swipe = { distance: 32, speed: 300 }

/** The step that plays the Defuse, and the one that plays a Skip. */
const Defusing = 2
const Skipping = 3

/** The discard pile: [kind, degrees, the step from which it's there], tilted as the game tilts its pile. Cards
 *  played before, then each the guide plays, once it has. */
const Pile: [Kind, number, number][] = [
  ['attack', -2, 0],
  ['nope', 1, 0],
  ['defuse', 2, Defusing + 1],
  ['skip', -1, Skipping + 1],
]

/** Where a card the guide plays comes to rest on the pile: degrees. */
const tilt = (kind: Kind) => Pile.find(([k]) => k === kind)![1]

/** A scene arriving fades in as the one before leaves. Into the Defuse, the Ekitten waiting in both, the one
 *  before goes only once it's covered, so the Ekitten never dims. Into the first, its card on the deck, the one
 *  before (the faces, after the game) goes first. `custom`: the step arriving. */
const Scene: Variants = {
  enter: { opacity: 0 },
  shown: (to: number) => ({ opacity: 1, transition: tween(Time.fade, to === 0 ? Time.micro : 0) }),
  leave: (to: number) => ({ opacity: 0, transition: tween(Time.micro, to === Defusing ? Time.fade : 0) }),
}

/** Seconds before it starts: the page around it settles in first, one motion at a time. */
const Wait = Time.ready + Time.enter

/** The last step: the game is over. */
const Last = Steps.length - 1

export function Guide({ face }: { face: number }) {
  // Each turn plays a step from its start; `n` counts them, so a step chosen again plays again (-1: none has
  // yet). `chosen`: you went there. `auto`: it still plays on by itself.
  const [{ step, n, chosen, auto }, setAt] = useState({ step: 0, n: -1, chosen: false, auto: true })
  const go = (to: number) => setAt({ step: (to + Steps.length) % Steps.length, n: n + 1, chosen: true, auto: false })
  const [paused, setPaused] = useState(false)
  // After a wait, once through, then back to the first, where it rests. A pause gives the step its beat again.
  useEffect(() => {
    if (!auto || paused) return
    const next = n < 0 ? 0 : (step + 1) % Steps.length
    return after(n < 0 ? Wait : beat(step), () => setAt({ step: next, n: n + 1, chosen: false, auto: n < 0 || step < Last }))
  }, [auto, n, paused])
  const [from, to] = Busy[step]!
  const started = useAt(from, n)
  const done = useAt(to, n)
  const busy = n >= 0 && started && !done
  const edges = Deck[step]![n >= 0 && done ? 1 : 0]!
  const press = useRef<{ x: number; t: number } | null>(null)

  return (
    // Its own layout ids: its sun is not the game's.
    <LayoutGroup id="guide">
      <div
        className="guide"
        onPointerEnter={(e) => e.pointerType === 'mouse' && setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onKeyDown={(e) => {
          const by = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
          if (!by) return
          // The arrows step through the rules, not the page or the sheet under them.
          e.preventDefault()
          go(step + by)
        }}
      >
        <div
          className="step"
          onPointerDown={(e) => {
            // Held, so its release comes here wherever it happens.
            e.currentTarget.setPointerCapture(e.pointerId)
            press.current = { x: e.clientX, t: e.timeStamp / 1000 }
          }}
          // Taken over by a scroll: no swipe.
          onPointerCancel={() => (press.current = null)}
          onPointerUp={(e) => {
            const p = press.current
            press.current = null
            if (!p) return
            const dx = e.clientX - p.x
            const fast = Math.abs(dx) / Math.max(0.001, e.timeStamp / 1000 - p.t) > Swipe.speed && Math.abs(dx) > Swipe.distance / 3
            if (Math.abs(dx) > Swipe.distance || fast) go(step - Math.sign(dx))
          }}
        >
          {/* The piles, still under every scene: the deck, and the cards played so far. */}
          <motion.span
            className="felt"
            aria-hidden
            initial={false}
            animate={{ opacity: busy ? 0 : 1 }}
            // Back once what was on the stage has gone (the faces, after the game).
            transition={tween(Time.fade, busy ? 0 : Time.micro)}
          >
            {/* The deck, as the table shows one: its top card over its edges, the lowest first. */}
            <span className="pile">
              {Array.from({ length: edges }, (_, i) => (
                <span key={i} className="edge" style={{ translate: `0 ${(edges - i) * Edges.step * (Width / CardWidth.stage)}px` }} />
              ))}
              <Card kind={null} width={Width} />
            </span>
            {Pile.filter(([, , from]) => step >= from).map(([kind, rotate]) => (
              <span key={kind} style={{ translate: `${Discard}px 0`, rotate: `${rotate}deg` }}>
                <Card kind={kind} width={Width} />
              </span>
            ))}
          </motion.span>
          {/* What happens in the step, over the table. */}
          <AnimatePresence custom={step}>
            <motion.div key={n} className="stage" aria-hidden custom={step} variants={Scene} initial="enter" animate="shown" exit="leave">
              {n >= 0 && step === 0 && <Draw kind="tacocat" />}
              {step === 1 && <Draw kind="exploding-kitten" />}
              {step === Defusing && <Defuse />}
              {step === Skipping && <Play />}
              {step === Last && <Win face={face} />}
            </motion.div>
          </AnimatePresence>
          {/* Read out only for a step you went to: one that plays on by itself would talk over the page. */}
          <p className="unseen" aria-live="polite">
            {chosen && <Named text={Steps[step]!} />}
          </p>
        </div>
        <ol className="rules">
          {Steps.map((text, i) => (
            <li key={text}>
              <button aria-current={i === step || undefined} onClick={() => go(i)}>
                <span className="n">{i + 1}</span>
                <span>
                  <Named text={text} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </LayoutGroup>
  )
}

/** True from `at` seconds into the scene on; with a `key`, counted again from each new one. (Below, every
 *  `animate` keeps each value it ever sets: one left out goes back to its `initial`.) */
function useAt(at: number, key?: number) {
  const [on, setOn] = useState({ key, on: at <= 0 })
  useEffect(() => {
    setOn({ key, on: at <= 0 })
    if (at > 0 && at !== Infinity) return after(at, () => setOn({ key, on: true }))
  }, [at, key])
  return on.key === key ? on.on : at <= 0
}

/** A card turned over as `up`: its back, and on the other side its face. */
function Flip({ kind, up }: { kind: Kind; up: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.span
      className="flip"
      // Reduced motion: no turn, its back fading off its face (styles.css).
      data-fade={reduce || undefined}
      data-up={up || undefined}
      initial={false}
      animate={{ rotateY: up && !reduce ? 180 : 0 }}
      transition={Spring.move}
    >
      <Card kind={null} width={Width} className="side" />
      <Card kind={kind} width={Width} className="side front" />
    </motion.span>
  )
}

/** A Skip comes up from your hand onto the stage, played; then it lands on the pile. Your turn ends without a
 *  draw: the plainest way a card keeps you safe. */
function Play() {
  const lands = useAt(Lands)
  return (
    <motion.span
      initial={{ x: Stage, y: Hand, rotate: 0, opacity: 0 }}
      animate={{ y: 0, opacity: 1, ...(lands && { x: Discard, rotate: tilt('skip') }) }}
      transition={{ ...Spring.move, delay: lands ? 0 : Leave, opacity: tween(Time.micro, Leave) }}
    >
      <Card kind="skip" width={Width} />
    </motion.span>
  )
}

/** A card leaves the deck for the stage, trembles face down, and turns over; then it goes to your hand. An
 *  Ekitten slams, and stays. */
function Draw({ kind }: { kind: Kind }) {
  const suspense = useAt(Suspense)
  const up = useAt(Reveal)
  const kitten = kind === 'exploding-kitten'
  const home = useAt(Home) && !kitten
  const slam = kitten && up
  return (
    <motion.span
      initial={{ x: 0, y: 0, opacity: 1 }}
      animate={{ x: Stage, ...(home && { y: Hand, opacity: 0 }) }}
      transition={{ ...Spring.move, delay: home ? 0 : Leave, opacity: tween(Time.fade) }}
    >
      <span className="tremble" data-on={(suspense && !up) || undefined}>
        <motion.span animate={slam ? { scale: [1, Slam.scale, 1] } : {}} transition={SlamTiming}>
          {/* Turned, it's a card like any other: its fade then can't show the back through it, as a 3D one's would. */}
          {home ? <Card kind={kind} width={Width} /> : <Flip kind={kind} up={up} />}
        </motion.span>
      </span>
    </motion.span>
  )
}

/** A Defuse comes up from your hand onto the Ekitten; the Ekitten, face down, goes back into the deck, and the
 *  Defuse onto the pile. */
function Defuse() {
  const hidden = useAt(Reveal)
  const lands = useAt(Lands)
  return (
    <>
      <motion.span initial={{ x: Stage }} animate={hidden ? { x: 0 } : {}} transition={Spring.move}>
        <Flip kind="exploding-kitten" up={!hidden} />
      </motion.span>
      <motion.span
        initial={{ x: Stage, y: Hand, rotate: 0, opacity: 0 }}
        animate={{ opacity: 1, ...(lands ? { x: Discard, y: 0, rotate: tilt('defuse') } : { y: Slap, rotate: -4 }) }}
        transition={{ ...Spring.move, delay: lands ? 0 : Leave, opacity: tween(Time.micro, Leave) }}
      >
        <Card kind="defuse" width={Width} />
      </motion.span>
    </>
  )
}

/** Seconds into the last step: the table clears, the three come in and are seen, then the others go out one by
 *  one, and the sun comes to you. */
const Seen = 2 * Time.fade + Hold.travel
const Out = [Seen, Seen + Hold.suspense]
const Won = Out[1]! + Hold.reveal

/** Seconds each step lasts: its last motion settled, then its rest. The draw's card gone to your hand; the
 *  Ekitten's slam; the Defuse, and the Skip, on the pile; the sun come to you. */
const Beats = [
  Home + Spring.move.visualDuration,
  Reveal + Slam.duration,
  Lands + Spring.move.visualDuration,
  Lands + Spring.move.visualDuration,
  Won + Spring.quick.visualDuration,
].map((settled) => settled + Hold.read)
const beat = (step: number) => Beats[step]!

/** Three at the table, the game's size. */
function Win({ face }: { face: number }) {
  const first = useAt(Out[0]!)
  const second = useAt(Out[1]!)
  const won = useAt(Won)
  const [a, b] = [1, 2].map((i) => (face + i) % Characters.length) as [number, number]
  return (
    // Once the table has cleared.
    <motion.span className="faces" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tween(Time.fade, Time.fade)}>
      <Avatar character={a} size={Face.seat} out={first} />
      <Avatar character={face} size={Face.seat} sun={won} />
      <Avatar character={b} size={Face.seat} out={second} />
    </motion.span>
  )
}
