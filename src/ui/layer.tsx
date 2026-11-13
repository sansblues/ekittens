import { animate, motion, useMotionValue, useReducedMotion, type MotionStyle, type MotionValue } from 'motion/react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'
import type { Kind } from '../engine'
import { Clock } from '../room'
import { after, listen, now } from './browser'
import { Card, Count, Emblem, Named } from './card'
import { CardWidth, Cue, Depth, Instant, NamedWidth, Press, Ratio, Slam, SlamTiming, Spring, Text, Time, tween } from './design'
import type { Game } from './game'
import { Fade } from './kit'
import type { Drag, Layout, Placed, Point, Rect } from './layout'
import { grab, whyNot, type Snapshot } from './table'
import { asks, Deck, label, Meta, toPlain } from './words'

// Every card on the table, in one layer. Each springs to wherever the layout puts it, from wherever
// it is and keeping its velocity, so any motion can be interrupted.

interface Props {
  game: Game
  snap: Snapshot
  layout: Layout
  drag: Drag | null
  setDrag: (d: Drag | null) => void
  /** The lifted card (hovered, or tapped): a tap on it plays it. */
  hover: number | null
  setHover: Dispatch<SetStateAction<number | null>>
  onLog: () => void
}

export function Layer({ game, snap, layout, drag, setDrag, hover, setHover, onLog }: Props) {
  const { pileTop } = layout
  const values = useRef(new Map<number, Values>()).current
  const flung = useRef(new Set<number>()).current
  const busy = useRef(false) // one press at a time, whatever React has rendered yet
  const base = layout.size.stage // every card is drawn at stage size, then scaled
  const layer = useRef<HTMLDivElement>(null)
  /** The card with the keyboard's focus, and the one that takes it over, as of the last render. */
  const focused = useRef<{ el: HTMLElement; next?: HTMLElement } | null>(null)

  // A card let go on its zone stays where it fell until the room answers with the move (a new view). With the line
  // down, or no answer in the room's pace (it turned the move down), it goes back.
  const sent = drag?.sent
  useLayoutEffect(() => {
    if (!sent) return
    if (sent !== snap.view || snap.offline) setDrag(null)
    else return after(Clock.pace, () => setDrag(null))
  }, [sent, snap.view, snap.offline, setDrag])

  // The focus never stays on a card out of reach: one played or drawn by keyboard hands it to the card that was
  // next to it, or to the first, or to the menu with none left.
  useLayoutEffect(() => {
    const reachable = [...layer.current!.querySelectorAll<HTMLElement>('.slotted[tabindex="0"]')]
    const was = focused.current
    const at = document.activeElement as HTMLElement | null
    // Still on it, out of reach now; or gone with it (the deck's top card, drawn).
    const lost = was && (at === was.el ? !reachable.includes(at) : at === document.body && !was.el.isConnected)
    if (lost) {
      const next = was.next && reachable.includes(was.next) ? was.next : reachable[0]
      ;(next ?? document.querySelector<HTMLElement>('.corner button'))?.focus({ preventScroll: true })
    }
    const i = reachable.indexOf(document.activeElement as HTMLElement)
    focused.current = i < 0 ? null : { el: reachable[i]!, next: reachable[i + 1] ?? reachable[i - 1] }
  })

  const press = (e: ReactPointerEvent, p: Placed) => {
    // A card held on its zone waits for the room: no other press until then.
    if (e.button !== 0 || !e.isPrimary || busy.current || sent) return
    const g = grab(snap, p.card)
    // A tap on a card you can't pick up shows its tip (touch has no hover); on the pile, it opens the log.
    if (!g) {
      if (e.pointerType !== 'mouse' && p.card.id !== pileTop) setHover(p.card.id)
      return
    }

    // A tap lifts a card (its rule shows); a tap on the lifted card plays it. A mouse lifts by hovering,
    // and the card the moment asks for is lifted already.
    const lifted = e.pointerType === 'mouse' || hover === p.card.id || !!p.act
    e.preventDefault()
    busy.current = true
    let current: Drag = { ids: g.ids, zone: g.zone, over: false }
    follow(e.nativeEvent, e.currentTarget as HTMLElement, {
      lead: values.get(p.card.id)!,
      twins: g.ids.slice(1).flatMap((id) => values.get(id) ?? []),
      base,
      rest: p.w / base,
      k: layout.k,
      zone: layout.zones[g.zone],
      onDrag: () => {
        setDrag(current)
        setHover(null)
      },
      onOver: (over) => setDrag((current = { ...current, over })),
      onEnd: (end) => {
        busy.current = false
        setDrag(null)
        if (!end) return
        if (end.tap && !lifted) {
          setHover(p.card.id)
          return
        }

        // A card that acts or was dropped takes no tip along to where it lands.
        setHover(null)
        if (end.tap) return game.make(p.card, g.move)
        if (end.flung) g.ids.forEach((id) => flung.add(id))
        // Dropped right on its zone, it has landed already; flung at it, it still has to fly there. Either way, it's
        // held until the room answers.
        const from = game.snap.view
        if (end.hit && game.make(p.card, g.move, end.inPlace)) setDrag({ ...current, sent: from })
      },
    })
  }

  return (
    <div ref={layer} className="layer">
      {layout.cards.map((p) => {
        const g = grab(snap, p.card)
        const dragging = !!drag?.ids.includes(p.card.id)
        const open = p.card.id === pileTop
        const card = p.dim && !p.under && snap.view.hand.find((c) => c.id === p.card.id)
        // The keyboard does what a tap would: open the log, or play the card. A stack is one card to it, as to the eye.
        const onPress = open ? onLog : g && !p.under ? () => game.make(p.card) : undefined
        return (
          <CardView
            key={p.card.id}
            p={p}
            base={base}
            values={values}
            flung={flung}
            dragging={dragging}
            fan={drag ? Math.max(0, drag.ids.indexOf(p.card.id)) : 0}
            grabbable={!!g}
            // Only for the cards held: the rest needn't hear the drag cross its zone.
            over={dragging && !!drag?.over && drag.zone !== 'hand'}
            open={open}
            reason={card ? whyNot(snap, card) : null}
            onPointerDown={(e) => press(e, p)}
            onPress={onPress}
            // Off only if it's still this card's: a blur must not wipe the next card's hover.
            onHover={(on) => setHover((h) => (on ? p.card.id : h === p.card.id ? null : h))}
          />
        )
      })}
      {/* The same dim as a sheet's scrim, at the same pace. */}
      <Fade show={layout.spotlight} className="spotlight" style={{ zIndex: Depth.dim }} />
    </div>
  )
}

interface ViewProps {
  p: Placed
  base: number
  values: Map<number, Values>
  flung: Set<number>
  dragging: boolean
  /** Its place in a dragged group: a cat's twins fan out by a few degrees each. */
  fan: number
  grabbable: boolean
  /** Dragged over the stage: it grows to stage size. */
  over: boolean
  /** The discard pile at rest: a click opens the log. */
  open: boolean
  reason: string | null
  onPointerDown: (e: ReactPointerEvent) => void
  /** What Enter or Space does; absent when there's nothing to do with this card. */
  onPress?: () => void
  onHover: (on: boolean) => void
}

function CardView({ p, base, values, flung, dragging, fan, grabbable, over, open, reason, onPointerDown, onPress, onHover }: ViewProps) {
  const reduce = useReducedMotion()
  const description = useId()
  const tx = p.x - base / 2
  const ty = p.y - (base * Ratio) / 2
  const scale = p.w / base
  const id = p.card.id
  const slam = !!p.slam
  const from = p.from && { ...p.from, x: p.from.x - base / 2, y: p.from.y - (base * Ratio) / 2 }
  const born = useRef(from ? { ...from, at: now() } : null)
  const dealt = born.current?.dealt !== undefined
  // How long a dealt card still waits inside the deck.
  const waiting = () => (born.current?.dealt === undefined ? 0 : Math.max(0, born.current.dealt - (now() - born.current.at)))
  // One setting off from inside a bot's avatar is there unseen, like the rest of that hand.
  const o = useMotionValue(dealt || from?.seat ? 0 : p.opacity)
  const x = useMotionValue(from ? from.x : tx)
  const y = useMotionValue(from ? from.y : ty)
  const rotate = useMotionValue(from ? 0 : p.rot)
  const s = useMotionValue(from ? (from.w ?? base) / base : scale)
  const face = useFace(p.up ? p.card.kind : null)
  const reach = !p.under && (!!onPress || p.dim)
  // Where it was last sent: a card that only rises or settles takes the quick spring; one that leaves
  // or reaches a bot's avatar is a cue, which the fade below reads too.
  const last = useRef({ tx, raised: !!p.raised, seat: !!p.seat })
  const body = useRef<HTMLDivElement>(null)
  const cue = useRef<'leave' | 'arrive' | null>(null)

  useEffect(() => {
    values.set(id, { x, y, scale: s })
    return () => void values.delete(id)
  }, [id, values, x, y, s])

  useEffect(() => {
    if (dragging) {
      const lifted = [animate(rotate, fan * 5, Spring.quick), animate(s, over ? 1 : scale * 1.04, Spring.quick)]
      return () => lifted.forEach((a) => a.stop())
    }
    // A dealt card waits its turn (measured from birth, so a re-run doesn't restart the wait).
    const delay = waiting()
    const lifting = last.current.raised !== !!p.raised && Math.abs(last.current.tx - tx) < 1
    // Born inside a bot's avatar, it is leaving for its first flight's length, timed from birth: React
    // may run a new card's effects twice.
    const since = born.current?.seat ? now() - born.current.at : Infinity
    const flying = since < Cue.wait + Spring.cue.visualDuration
    const leaving = flying || (last.current.seat && !p.seat)
    cue.current = reduce ? null : leaving ? 'leave' : !last.current.seat && p.seat ? 'arrive' : null
    last.current = { tx, raised: !!p.raised, seat: !!p.seat }
    const spring = cue.current ? Spring.cue : flung.has(id) ? Spring.thrown : lifting ? Spring.quick : Spring.move
    // A card leaving an avatar shows there first.
    const shows = flying ? Math.max(0, Cue.wait - since) : Cue.wait
    const t = reduce ? Instant : { ...spring, delay: cue.current === 'leave' ? shows : delay }
    flung.delete(id)
    // The impact comes from the card itself, not a shaken screen.
    const grow = slam && !reduce ? animate(s, [s.get(), scale * Slam.scale, scale], SlamTiming) : animate(s, scale, t)
    // Reduced motion: a card that goes somewhere new (not a hand making room) doesn't travel there; it dissolves in
    // where it lands.
    const away = Math.hypot(x.get() - tx, y.get() - ty) > p.w / 2
    const dissolve = reduce && !lifting && away && animate(body.current!, { opacity: [0, 1] }, tween(Time.fade))
    const run = [animate(x, tx, t), animate(y, ty, t), animate(rotate, p.rot, t), grow]
    return () => {
      run.forEach((a) => a.stop())
      // Cut short, it's whole at once: never left half-seen.
      if (dissolve) dissolve.complete()
    }
  }, [tx, ty, p.rot, scale, dragging, fan, over, x, y, rotate, s, flung, id, reduce, slam, p.raised, p.seat])

  // A dealt card stays invisible in the deck until its turn. One reaching a bot's avatar stays in view
  // to the end of its flight, then melts in.
  useEffect(() => {
    const wait = waiting()
    const melt = cue.current === 'arrive'
    cue.current = null
    const a =
      wait > 0 ? animate(o, [0, 1], { ...Instant, delay: wait }) : animate(o, p.opacity, tween(Time.fade, melt ? Cue.melt : (p.wait ?? 0)))
    return () => a.stop()
  }, [p.opacity, o])

  return (
    <motion.div
      className="slotted"
      data-mini={p.w < NamedWidth || p.compact || undefined}
      data-dim={p.dim || undefined}
      data-recede={p.recede || undefined}
      data-act={(p.act && !dragging) || undefined}
      data-grab={grabbable || undefined}
      data-open={open || undefined}
      style={
        {
          x,
          y,
          rotate,
          scale: s,
          zIndex: dragging ? Depth.dragged - fan : p.z,
          width: base,
          opacity: o,
          // Its shadow's depth, unscaled so it looks the same at any size; a dragged card is held high.
          '--lift': `${(dragging ? 10 : p.lift) / scale}px`,
          '--unscale': 1 / scale,
        } as MotionStyle
      }
      onPointerDown={onPointerDown}
      // A pointer plays a card through its press; a screen reader activates with a click of no pointer (detail 0).
      onClick={(e) => (open || e.detail === 0) && onPress?.()}
      // A dimmed card of yours is reached too, for its rule and why it can't be played now; a stack, by its top.
      tabIndex={reach ? 0 : -1}
      role={reach ? 'button' : 'img'}
      aria-disabled={(reach && !onPress) || undefined}
      // Unseen (a bot's cards, resting inside its avatar) or under a stack's top: not there to a screen reader either.
      aria-hidden={p.opacity === 0 || p.under || undefined}
      aria-label={label(p, open)}
      aria-describedby={reach ? description : undefined}
      onKeyDown={(e) => {
        if (!onPress || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        // A held key acts once: its repeats would go on to the sheet the card raises, and choose there.
        if (!e.repeat) onPress()
      }}
      // Hover follows real pointer movement, not cards sliding under a resting pointer.
      onPointerMove={(e) => e.pointerType === 'mouse' && (e.movementX || e.movementY) && onHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onHover(false)}
      // Keyboard focus is a hover too: the card comes forward (its ring in full view), with its rule.
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && onHover(true)}
      onBlur={() => onHover(false)}
    >
      {reach && (
        <span id={description} hidden>
          {toPlain(p.up && p.card.kind ? Meta[p.card.kind].rule : Deck.rule)}
          {reason ? ` ${toPlain(reason)}` : open ? ' Open the game log.' : ''}
        </span>
      )}
      <div ref={body} className="tremble" data-on={p.tremble || undefined}>
        <motion.div
          className="flip"
          aria-hidden
          // Reduced motion: no turn, its back fading off its face (styles.css).
          data-fade={reduce || undefined}
          data-up={p.up || undefined}
          // A card dealt to you leaves the deck face-down and turns over on its way.
          initial={dealt && p.up && !reduce ? { rotateY: 180 } : false}
          animate={{ rotateY: p.up || reduce ? 0 : 180 }}
          transition={reduce ? Instant : { ...Spring.move, delay: dealt ? waiting() + Time.fade : 0 }}
          // Dealt and turned over: from now on it flips like any other card.
          onAnimationComplete={() => (born.current = null)}
        >
          {/* A face-down card carries no face at all: nothing to find in the page. */}
          <Card kind={face} width={base} className="side front" />
          <Card kind={null} width={base} className="side rear" />
        </motion.div>
      </div>
      {/* The deck's badge also counts its Ekittens: "×17 [kitten]×3". */}
      {p.count && (
        <span className="badge" style={{ fontSize: badgeSize(base, p.w) }}>
          <Count n={p.count} />
          {!!p.kittens && (
            <span className="named">
              <Emblem kind="exploding-kitten" />
              <Count n={p.kittens} />
            </span>
          )}
        </span>
      )}
      {/* What a triple asks for, public like the play; it fades once answered. */}
      <Fade show={!!p.asks} className="ask" style={{ fontSize: badgeSize(base, p.w) }}>
        <span className="badge">
          <Named text={asks(p.asks!)} />
        </span>
      </Fade>
    </motion.div>
  )
}

/** The face to render: kept until the flip has turned the card face-down. */
function useFace(kind: Kind | null): Kind | null {
  const [face, setFace] = useState(kind)
  useEffect(() => {
    if (kind) return setFace(kind)
    return after(Spring.move.visualDuration, () => setFace(null))
  }, [kind])
  return kind ?? face
}

/** A badge's font size: small on a full-size card, scaling with the cards but never under a caption, and
 *  undoing the card's own scale. */
const badgeSize = (base: number, w: number) => (Math.max(Text.caption, Text.small * (base / CardWidth.stage)) * base) / w

/** x and y are its top-left corner, not its center. */
interface Values {
  x: MotionValue<number>
  y: MotionValue<number>
  scale: MotionValue<number>
}

interface Grip {
  lead: Values
  twins: Values[]
  /** The size every card is drawn at before it's scaled, and this card's resting scale. */
  base: number
  rest: number
  /** The cards' scale on this screen. */
  k: number
  zone: Rect
  /** It left a tap's slop: it's a drag now. */
  onDrag: () => void
  onOver: (over: boolean) => void
  /** A tap, or a drop on its zone: `inPlace` if it was let go right there, `flung` if thrown hard. */
  onEnd: (end: { tap: true } | { tap: false; hit: boolean; inPlace: boolean; flung: boolean } | null) => void
}

function follow(e: PointerEvent, el: HTMLElement, { lead, twins, base, rest, k, zone, onDrag, onOver, onEnd }: Grip) {
  el.setPointerCapture(e.pointerId)
  // The card gives a little under your finger at once, until you let go or move it.
  animate(lead.scale, rest * Press.scale, Press.transition)
  let origin = { x: 0, y: 0 }
  const center = (x: number, y: number) => ({ x: x + base / 2, y: y + (base * Ratio) / 2 })
  let moved = false
  let over = false

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    // A mouse let go where the page never heard it (over another window, say): the drag is over.
    if (ev.pointerType === 'mouse' && ev.buttons === 0) return end(true)
    const dx = ev.clientX - e.clientX
    const dy = ev.clientY - e.clientY
    // A tap may drift a little (8 px: Android's touch slop) and still be a tap.
    if (!moved && Math.hypot(dx, dy) < 8) return
    if (!moved) {
      moved = true
      // Grab it where it is, mid-flight or not, only now: a tap must leave its flight alone, or it stops halfway.
      for (const v of [lead, ...twins]) [v.x, v.y].forEach((m) => m.stop())
      origin = { x: lead.x.get() - dx, y: lead.y.get() - dy }
      onDrag()
    }
    // The card stays exactly under your finger: no jumps.
    const x = origin.x + dx
    const y = origin.y + dy
    lead.x.set(x)
    lead.y.set(y)
    twins.forEach((t, i) => {
      t.x.set(x + (i + 1) * 14 * k)
      t.y.set(y + (i + 1) * 4 * k)
    })
    const here = inside(zone, center(x, y), 24 * k)
    if (here !== over) onOver((over = here))
  }

  const end = (cancelled: boolean) => {
    stops.forEach((stop) => stop())
    if (!moved) {
      // Let go: the card springs back (and on, if this tap plays it).
      animate(lead.scale, rest, Press.transition)
      return onEnd(cancelled ? null : { tap: true })
    }
    // Where was it heading? A flick toward the zone counts (thrown: over 600 px/s).
    const vx = lead.x.getVelocity()
    const vy = lead.y.getVelocity()
    const landing = center(lead.x.get() + project(vx), lead.y.get() + project(vy))
    const hit = !cancelled && (over || inside(zone, landing, 0))
    // Thrown at its zone, it carries on to where it would come to rest while the room hears of the move.
    if (hit && !over) [[lead.x, vx] as const, [lead.y, vy] as const].forEach(([m, v]) => animate(m, m.get() + project(v), Spring.move))
    onEnd({ tap: false, hit, inPlace: over, flung: Math.hypot(vx, vy) > 600 })
  }

  // The end heard on the window: a card taken from your hand mid-drag (stolen) ends it there, not on itself.
  const stops = [
    listen(el, 'pointermove', move),
    ...(['pointerup', 'pointercancel', 'lostpointercapture'] as const).map((type) =>
      listen(window, type, (ev) => ev.pointerId === e.pointerId && end(ev.type !== 'pointerup')),
    ),
    // A new screen size moves every place: what it was aimed at is gone, so it goes back.
    listen(window, 'resize', () => end(true)),
  ]
}

/** Apple's momentum projection: where a flick would come to rest (the snappier 0.99 rate). */
const project = (v: number, d = 0.99) => ((v / 1000) * d) / (1 - d)

const inside = (r: Rect, p: Point, margin: number) => Math.abs(p.x - r.x) <= r.w / 2 + margin && Math.abs(p.y - r.y) <= r.h / 2 + margin
