import { useReducedMotion, useSpring, useTransform, motion, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { after, listen } from './browser'
import { Blink, Spring } from './design'
import IconSvg from '../../public/icon.svg?raw'

const Icon = `data:image/svg+xml,${encodeURIComponent(IconSvg)}`

// The game's icon beside its name in two lines of capitals, as tall as the icon: one block, as on a box. The
// cat on it watches your pointer, and now and then blinks.

/** The cat's eyes, in hundredths of the icon (from icon.svg's drawing): their centres, and their half size. */
const Eyes = [
  { x: 63.86, y: 37.14 },
  { x: 77.39, y: 37.14 },
]
const Eye = { rx: 4.95, ry: 6.27 }

/** A pupil's radius, and how far it may move from its eye's centre, in hundredths of the icon: its rim stays
 *  inside the eye. */
const Pupil = 2.6
const Reach = { x: 2, y: 3.2 }

/** px: how far the pointer must be for the eyes to look all the way over. */
const Far = 320

export function Logo() {
  const reduce = useReducedMotion()
  const icon = useRef<HTMLSpanElement>(null)
  const x = useSpring(0, Spring.follow)
  const y = useSpring(0, Spring.follow)
  useEffect(() => {
    if (reduce) return
    const look = (e: PointerEvent) => {
      const r = icon.current?.getBoundingClientRect()
      if (!r) return
      // From between the eyes.
      const dx = e.clientX - (r.left + r.width * 0.706)
      const dy = e.clientY - (r.top + r.height * 0.371)
      const d = Math.hypot(dx, dy) || 1
      const pull = Math.min(d / Far, 1)
      x.set((dx / d) * pull * Reach.x)
      y.set((dy / d) * pull * Reach.y)
    }
    const offs = [listen(window, 'pointermove', look), listen(window, 'pointerdown', look)]
    return () => offs.forEach((off) => off())
  }, [reduce])
  const [shut, setShut] = useState(false)
  useEffect(() => {
    if (reduce) return
    return shut ? after(Blink.shut, () => setShut(false)) : after(Blink.every + Math.random() * Blink.give, () => setShut(true))
  }, [shut, reduce])

  return (
    <h1 className="logo">
      <span ref={icon} className="cat">
        {/* Decoded with the frame it's in: shown again (home to a room's lobby), it never blinks empty. Part of
            the page, not fetched: shown again with the network gone, the browser fetched it anew, and failed. */}
        <img src={Icon} alt="" decoding="sync" draggable={false} />
        {Eyes.map((at, i) => (
          <Look key={i} at={at} x={x} y={y} shut={shut} />
        ))}
      </span>
      <span>
        <span>Exploding</span> <span>Kittens</span>
      </span>
    </h1>
  )
}

/** One eye: its pupil, moved by the pointer, and its lid, which closes over it to blink. A shift in
 *  hundredths of the icon becomes a share of the pupil's own size, which `translate` in % is relative to. */
function Look({ at, x, y, shut }: { at: { x: number; y: number }; x: MotionValue<number>; y: MotionValue<number>; shut: boolean }) {
  const share = (n: number) => `${(n / (2 * Pupil)) * 100}%`
  const px = useTransform(x, share)
  const py = useTransform(y, share)
  const box = { left: `${at.x - Eye.rx}%`, top: `${at.y - Eye.ry}%`, width: `${2 * Eye.rx}%`, height: `${2 * Eye.ry}%` }
  return (
    <span className="eye" style={box} aria-hidden>
      <motion.span className="pupil" style={{ x: px, y: py, width: `${(Pupil / Eye.rx) * 100}%` }} />
      <span className="lid" data-shut={shut || undefined} />
    </span>
  )
}
