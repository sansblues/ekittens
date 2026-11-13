import { motion } from 'motion/react'
import { Blur, Instant, Spring, Time, tween } from './design'
import { Characters } from '../lobby'

export const avatar = (character: number) => `/avatars/${Characters[character]!.key}.svg`

interface Props {
  character: number
  /** px, or a CSS length a stylesheet sets. */
  size: number | string
  out?: boolean
  /** There is only ever one: Motion's shared layout glides it to the next player. */
  sun?: boolean
  /** The face glides here from wherever the same id last showed: a lobby's face to its seat in the game. */
  layoutId?: string
}

export function Avatar({ character, size, out = false, sun = false, layoutId }: Props) {
  return (
    <motion.span layoutId={layoutId} className="avatar" data-out={out || undefined} style={{ width: size, height: size }} aria-hidden>
      {sun && (
        // An HTML box, not an SVG: Motion's shared layout measures and projects HTML elements.
        <motion.span
          layoutId="sun"
          className="burst"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          // Quick to show, gliding between players: nothing threw it, so it never overshoots.
          transition={{ ...Spring.quick, layout: Spring.move }}
        >
          <svg viewBox="0 0 100 100">
            <path d={Burst} />
          </svg>
        </motion.span>
      )}
      <img className="face" src={avatar(character)} alt="" draggable={false} />
    </motion.span>
  )
}

/** A face before the game: on Play it glides to its seat. Changed, the new one is there at once, blurred, and
 *  sharpens where it is: never a moment without a face, never across the screen from wherever it last
 *  showed. `still`: it stays put, as one face shown twice on a screen must (Motion would show only one). */
export function Seated({ face, size, still = false }: { face: number; size: number | string; still?: boolean }) {
  return (
    <motion.span
      key={face}
      className="glide"
      layoutId={still ? undefined : `seat-${face}`}
      initial={{ filter: Blur }}
      animate={{ filter: 'blur(0px)' }}
      transition={{ ...tween(Time.fade), layout: Instant }}
    >
      <Avatar character={face} size={size} />
    </motion.span>
  )
}

/** The sun: rays round a square with soft corners (a superellipse), spaced evenly along its edge, so a face's
 *  corners sit inside it. In its 100 units, a ray reaches 50 from the middle, and rises from 38. */
const Burst = (() => {
  const rays = 16
  const steps = 720
  const edge = Array.from({ length: steps }, (_, i) => {
    const a = (2 * Math.PI * i) / steps - Math.PI / 2
    const [x, y] = [Math.cos(a), Math.sin(a)]
    const r = (Math.abs(x) ** 6 + Math.abs(y) ** 6) ** (-1 / 6)
    return [x * r, y * r] as const
  })
  const along = [0]
  for (let i = 1; i < steps; i++) along.push(along[i - 1]! + Math.hypot(edge[i]![0] - edge[i - 1]![0], edge[i]![1] - edge[i - 1]![1]))
  const pts = Array.from({ length: rays * 2 }, (_, j) => {
    const i = along.findIndex((d) => d >= (j / (rays * 2)) * along[steps - 1]!)
    const [x, y] = edge[i]!
    const r = j % 2 ? 38 : 50
    return `${(50 + x * r).toFixed(1)} ${(50 + y * r).toFixed(1)}`
  })
  return `M${pts.join('L')}Z`
})()
