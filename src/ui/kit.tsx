import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from 'motion/react'
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { after, input, now } from './browser'
import { Blur, Hurry, Time, tween } from './design'
import type { Drain } from './table'

/** Until when a tip shows at once, with no rise: one has just been shown. */
let warm = 0

/** Whether a resting pointer has earned a tip yet: after a rest, at once on touch (a tap is a clear ask), and
 *  at once, without its rise, while one has just shown. */
export function useRest(resting: boolean) {
  const [shown, setShown] = useState<{ instant: boolean } | null>(null)
  useEffect(() => {
    if (!resting) {
      if (shown) warm = now() + Time.rest
      return setShown(null)
    }
    if (shown) return
    const instant = now() < warm
    return after(instant || input() === 'touch' ? 0 : Time.rest, () => setShown({ instant }))
  }, [resting, shown])
  return shown
}

/** A tip on a thing of its own: shown once a mouse rests on it, or for a moment after a tap or `tell()`.
 *  Spread `bind` on the thing. */
export function useTell() {
  const [over, setOver] = useState(false)
  const [told, setTold] = useState(false)
  useEffect(() => (told ? after(Time.told, () => setTold(false)) : undefined), [told])
  const rest = useRest(over)
  return {
    shown: !!rest || told,
    tell: () => setTold(true),
    bind: {
      onPointerEnter: (e: PointerEvent) => e.pointerType === 'mouse' && setOver(true),
      onPointerLeave: () => setOver(false),
      onPointerDown: (e: PointerEvent) => e.pointerType !== 'mouse' && setTold(true),
    },
  }
}

export function Fade({
  show,
  enter = Time.fade,
  leave = Time.micro,
  wait = 0,
  ...rest
}: { show: boolean; enter?: number; leave?: number; wait?: number } & HTMLMotionProps<'div'>) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tween(enter) }}
          exit={{ opacity: 0, transition: tween(leave, wait) }}
          {...rest}
        />
      )}
    </AnimatePresence>
  )
}

export function Swap({ id, ...rest }: { id: string } & HTMLMotionProps<'div'>) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={id}
        initial={{ opacity: 0, filter: Blur }}
        animate={{ opacity: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, filter: Blur, transition: tween(Time.micro) }}
        transition={tween(Time.fade)}
        {...rest}
      />
    </AnimatePresence>
  )
}

/** `value`, once it has lasted a moment (until then, none): what passes quickly ("Connecting…") never flickers. */
export function useLate<T>(value: T | undefined): T | undefined {
  const [late, setLate] = useState<T>()
  useEffect(() => (value === undefined ? setLate(undefined) : after(Time.late, () => setLate(value))), [value])
  return value === undefined ? undefined : late
}

/** A sign on a face's corner: at its bottom (what it is, or what a tap does), or at its top. `reveal`: only
 *  while a pointer or the keyboard is on the face. */
export function Tag({ at = 'bottom', reveal, children }: { at?: 'top' | 'bottom'; reveal?: boolean; children: ReactNode }) {
  return (
    <span className="tag" data-at={at} data-reveal={reveal || undefined} aria-hidden>
      {children}
    </span>
  )
}

/** A button that is its sign alone, named for a screen reader: 36 px to the eye, 44 to a finger. */
export function IconButton({ label, ...rest }: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="icon-button" aria-label={label} {...rest} />
}

/** Set on what the game raised by itself, unasked (a Favor's give, the end): a press in its first moment was
 *  aimed at what was there before. */
export const Unbidden = createContext(false)

/** Guards a click handler on what rose unasked (`Unbidden`): a press in its first moment was meant for what was
 *  there before. On what you opened yourself, every click counts, however quick. */
export function useFresh() {
  const shown = useRef(now())
  const unbidden = use(Unbidden)
  return <A extends unknown[]>(fn?: (...a: A) => void) =>
    (...a: A) => {
      if (!unbidden || now() - shown.current >= Time.fresh) fn?.(...a)
    }
}

/** `square`: its sign alone, as tall as it is wide. */
export function Option({
  primary,
  square,
  onClick,
  ...rest
}: { primary?: boolean; square?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const fresh = useFresh()
  return (
    <button className={['option', primary && 'primary', square && 'square'].filter(Boolean).join(' ')} onClick={fresh(onClick)} {...rest} />
  )
}

/** Text on one line that, too long for its room, fades out at its end rather than ending in "…". */
export function Fit({ className, children, ...rest }: { className: string; children: string } & HTMLAttributes<HTMLSpanElement>) {
  const ref = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current!
    const watch = new ResizeObserver(() => setCut(el.scrollWidth > el.clientWidth))
    watch.observe(el)
    return () => watch.disconnect()
  }, [children])
  return (
    <span ref={ref} className={`fit ${className}`} data-cut={cut || undefined} {...rest}>
      {children}
    </span>
  )
}

/** A line drawing (on the 24 grid, unless `view` says otherwise), in the text's color, its stroke one weight at
 *  any size. */
function Glyph({
  className = '',
  view = '0 0 24 24',
  style,
  children,
}: {
  className?: string
  view?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <svg className={`glyph ${className}`} viewBox={view} style={style} aria-hidden>
      {children}
    </svg>
  )
}

/** A hand of cards: how many someone holds. */
export function CardsIcon() {
  return (
    <Glyph className="cards-icon">
      <rect x="4.5" y="4" width="10" height="14" rx="2" transform="rotate(-14 9.5 18)" />
      <rect x="9" y="4.5" width="10" height="14" rx="2" transform="rotate(9 14 18.5)" />
    </Glyph>
  )
}

/** The way the turn goes, from seat to seat: a quick arc by hand, passed on rather than aimed. */
export function Onward({ style }: { style?: CSSProperties }) {
  return (
    <Glyph className="onward" view="0 0 40 24" style={style}>
      <path d="M4 16.5C9.5 9 18 6.5 26 8.6c4 1.1 6.7 3.3 8.5 5.6M29.4 15.2c2.2-.1 4-.4 5.3-1 .3-1.6.1-3.3-.6-5" />
    </Glyph>
  )
}

/** Who a play is aimed at. */
export function Arrow() {
  return (
    <Glyph className="arrow">
      <path d="M6.5 12h11M12.5 7l5 5-5 5" />
    </Glyph>
  )
}

// From here on, the signs are Lucide's (lucide.dev), drawn in our stroke (styles.css .glyph); their license,
// which has to ship with them, is public/lucide-license.txt. The game's own marks are above.

export function FriendsIcon() {
  return (
    <Glyph>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Glyph>
  )
}

export function BotIcon() {
  return (
    <Glyph>
      <path d="M12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
    </Glyph>
  )
}

/** In through a door: Leave's mirror. */
export function JoinIcon() {
  return (
    <Glyph>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
    </Glyph>
  )
}

export function LeaveIcon() {
  return (
    <Glyph>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </Glyph>
  )
}

export function PlayIcon() {
  return (
    <Glyph>
      <path d="M6 3l14 9-14 9z" />
    </Glyph>
  )
}

export function AgainIcon() {
  return (
    <Glyph>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
    </Glyph>
  )
}

/** Back where you came from: the table. */
export function BackIcon() {
  return (
    <Glyph>
      <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Glyph>
  )
}

export function CheckIcon() {
  return (
    <Glyph>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  )
}

/** To the next one. */
export function TurnIcon() {
  return (
    <Glyph>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
    </Glyph>
  )
}

export function PlusIcon() {
  return (
    <Glyph>
      <path d="M5 12h14M12 5v14" />
    </Glyph>
  )
}

export function CloseIcon() {
  return (
    <Glyph>
      <path d="M18 6 6 18M6 6l12 12" />
    </Glyph>
  )
}

export function LinkIcon() {
  return (
    <Glyph>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Glyph>
  )
}

export function HelpIcon() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </Glyph>
  )
}

/** What happened: a clock, turned back. */
export function HistoryIcon() {
  return (
    <Glyph>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2" />
    </Glyph>
  )
}

/** A speaker: sounding, or struck through. */
export function SoundIcon({ on }: { on: boolean }) {
  return (
    <Glyph>
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      {on ? <path d="M16 9a5 5 0 0 1 0 6M19.364 18.364a9 9 0 0 0 0-12.728" /> : <path d="M22 9l-6 6M16 9l6 6" />}
    </Glyph>
  )
}

export function EyeIcon() {
  return (
    <Glyph>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  )
}

export function HiddenIcon() {
  return (
    <Glyph>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20" />
    </Glyph>
  )
}

export function ShuffleIcon() {
  return (
    <Glyph>
      <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4" />
    </Glyph>
  )
}

export function MenuIcon() {
  return (
    <Glyph>
      <path d="M4 12h16M4 6h16M4 18h16" />
    </Glyph>
  )
}

/** A clock emptying. A negative delay starts it partway when it shows late; fixed as it shows, so a
 *  re-render can't re-time it. */
export function Draining({ from, length }: Drain) {
  const [delay] = useState(() => Math.min(0, from - now()))
  return (
    <div className="clock" aria-hidden>
      <div className="drain" style={{ animationDelay: `${delay}s`, animationDuration: `${length}s` }} />
    </div>
  )
}

/** Read the deadline each time so a background tab never counts from a stale number. */
export function TimeLeft({ ends }: { ends: number }) {
  const present = useIsPresent()
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil(ends - now())))
  useEffect(() => {
    let stop = () => {}
    const tick = () => {
      const left = Math.max(0, ends - now())
      const seconds = Math.ceil(left)
      setSeconds(seconds)
      if (left > 0) stop = after(left - seconds + 1, tick)
    }
    tick()
    return () => stop()
  }, [ends])
  return (
    <span
      className="time-left"
      role="timer"
      aria-hidden={!present || undefined}
      aria-label={`${seconds} ${seconds === 1 ? 'second' : 'seconds'} left`}
      data-near={seconds <= Hurry.show || undefined}
    >
      {seconds}s
    </span>
  )
}
