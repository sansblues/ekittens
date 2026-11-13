import type { CSSProperties } from 'react'
import { input } from './browser'
import { CardTip } from './card'
import { useRest } from './kit'
import type { Layout } from './layout'
import { whyNot, type Snapshot } from './table'
import { hint, left } from './words'

export function Tip({ snap, tip }: { snap: Snapshot; tip: Layout['tip'] }) {
  const shown = useRest(!!tip)
  if (!tip || !shown) return null
  const { p, on, x, y } = tip
  // Only a card of yours is ever dimmed.
  const mine = p.dim && snap.view.hand.find((c) => c.id === p.card.id)
  // The deck's tip says what its badge counts.
  const counts = on === 'deck' && p.count !== undefined && left(p.count, p.kittens ?? 0)
  const note = mine ? whyNot(snap, mine) : [counts, hint(on, input())].filter(Boolean).join(' ')
  return (
    <div
      className="tip"
      aria-hidden
      data-instant={shown.instant || undefined}
      style={{ left: x, top: y, '--y': `${y}px` } as CSSProperties}
    >
      <CardTip kind={on === 'deck' ? null : p.card.kind} note={note} />
    </div>
  )
}
