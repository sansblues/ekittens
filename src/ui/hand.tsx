import { useAnimationFrame } from 'motion/react'
import { useRef, useState, type ButtonHTMLAttributes, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import type { Card as CardT, Kind } from '../engine'
import { Card, CardTip, Count } from './card'
import { useFresh } from './kit'
import { CardWidth as Widths, Depth, Gutter, Ratio, Sheet, TipWidth } from './design'
import { Meta, counted } from './words'

const CardWidth = Widths.sheet

/** How far a lifted card rises (px). */
const Lift = 16

/** px: the least of a card a finger can tell from the next. */
const Strip = 32

/** The width inside a sheet; on a small screen the sheet keeps a gutter clear of each side. */
export const room = () => Math.min(Sheet.width, window.innerWidth - 2 * Gutter) - 2 * Sheet.pad

/** `count` cards in as few rows as keep each one's strip `Strip` wide: its size, and where card `i` sits. */
function rows(count: number) {
  const gap = 12
  const strip = (perRow: number) => (room() - CardWidth) / Math.max(1, perRow - 1)
  let rows = 1
  while (strip(Math.ceil(count / rows)) < Strip && rows < count) rows++
  const perRow = Math.ceil(count / rows)
  const step = perRow > 1 ? Math.min(CardWidth * 0.8, strip(perRow)) : 0
  return {
    width: CardWidth + step * (perRow - 1),
    height: Lift + rows * CardWidth * Ratio + (rows - 1) * gap,
    at: (i: number) => {
      const row = Math.floor(i / perRow)
      const inRow = Math.min(perRow, count - row * perRow)
      // A shorter last row is centered under the others.
      return { x: (i % perRow) * step + ((perRow - inRow) * step) / 2, y: row * (CardWidth * Ratio + gap) }
    },
  }
}

/** Another player's hand, face down in the order the engine shuffled it. */
export function Spread({ count, onPick }: { count: number; onPick: (index: number) => void }) {
  const [lifted, setLifted] = useState<number | null>(null)
  const fresh = useFresh()
  const { width, height, at } = rows(count)
  return (
    <div className="fan" style={{ width, height }}>
      {Array.from({ length: count }, (_, i) => (
        <HandCard
          key={i}
          i={i}
          up={lifted === i}
          onLift={setLifted}
          {...at(i)}
          onClick={fresh(() => onPick(i))}
          aria-label={`Card ${i + 1} of ${count}`}
        >
          <Card kind={null} width={CardWidth} />
        </HandCard>
      ))}
    </div>
  )
}

export function Fan({ groups, onPick }: { groups: CardT[][]; onPick: (group: CardT[]) => void }) {
  const [lifted, setLifted] = useState<number | null>(null)
  const fresh = useFresh()
  const fan = useRef<HTMLDivElement>(null)
  const n = groups.length
  const spread = Math.min(3, 28 / Math.max(n, 1))
  // The end cards tilt outward about a point below them: their swing stays inside the sheet too.
  const swing = Math.ceil(CardWidth * Ratio * 1.2 * Math.sin((((spread * (n - 1)) / 2) * Math.PI) / 180))
  const step = n > 1 ? Math.min(CardWidth * 0.8, (room() - CardWidth - 2 * swing) / (n - 1)) : 0
  const off = (i: number) => i - (n - 1) / 2
  const sag = (i: number) => off(i) ** 2 * 1.2
  // Too many kinds for one arc a finger can pick from (a phone's): in rows, as another's hand is.
  const flat = step < Strip && n > 1 ? rows(n) : null
  const at = (i: number) => flat?.at(i) ?? { x: i * step, y: sag(i), tilt: off(i) * spread }
  return (
    // Its height holds the curve: the end cards sit lowest, and still clear the sheet's padding.
    <div
      ref={fan}
      className="fan"
      style={
        flat
          ? { width: flat.width, height: flat.height }
          : { width: CardWidth + step * (n - 1), height: CardWidth * Ratio + Lift + 8 + sag(0) }
      }
    >
      {groups.map((g, i) => (
        <HandCard
          key={g[0]!.kind}
          i={i}
          up={lifted === i}
          onLift={setLifted}
          {...at(i)}
          onClick={fresh(() => {
            setLifted(null) // the rule goes with the pick, not after the sheet
            onPick(g)
          })}
          aria-label={g.length > 1 ? counted(g.length, g[0]!.kind) : Meta[g[0]!.kind].name}
        >
          <Card kind={g[0]!.kind} width={CardWidth} />
          {g.length > 1 && (
            <span className="badge">
              <Count n={g.length} />
            </span>
          )}
        </HandCard>
      ))}
      {lifted !== null && <FloatTip fan={fan} kind={groups[lifted]![0]!.kind} x={at(lifted).x + CardWidth / 2} y={at(lifted).y - 6} />}
    </div>
  )
}

/** It lifts under the pointer or with keyboard focus, into the room left above the hand for it. */
function HandCard({
  i,
  up,
  onLift,
  x,
  y,
  tilt = 0,
  ...rest
}: {
  i: number
  up: boolean
  onLift: Dispatch<SetStateAction<number | null>>
  x: number
  y: number
  tilt?: number
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const drop = () => onLift((l) => (l === i ? null : l))
  return (
    <button
      className="fan-card"
      // A lifted card comes whole in front of its neighbors.
      style={{ left: x, zIndex: up ? Depth.lifted : i, transform: `translateY(${up ? y : y + Lift}px) rotate(${tilt}deg)` }}
      // A finger's tap picks at once: only a mouse lifts a card to read it first.
      onPointerEnter={(e) => e.pointerType === 'mouse' && onLift(i)}
      onPointerLeave={drop}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && onLift(i)}
      onBlur={drop}
      {...rest}
    />
  )
}

/** Portaled out, so the sheet never clips it, and placed every frame to follow the card while the sheet still rises. */
function FloatTip({ fan, kind, x, y }: { fan: RefObject<HTMLDivElement | null>; kind: Kind; x: number; y: number }) {
  const tip = useRef<HTMLDivElement>(null)
  useAnimationFrame(() => {
    const f = fan.current?.getBoundingClientRect()
    const s = fan.current?.closest('.sheet')?.getBoundingClientRect()
    if (!f || !s || !tip.current) return
    const half = TipWidth / 2 + 12 // the tip keeps 12 px inside the sheet's sides
    tip.current.style.left = `${Math.min(Math.max(f.left + x, s.left + half), s.right - half)}px`
    tip.current.style.top = `${f.top + y}px`
  })
  return createPortal(
    <div ref={tip} className="tip float">
      <CardTip kind={kind} />
    </div>,
    document.body,
  )
}
