import type { CSSProperties } from 'react'
import { Edges, Ratio, Time } from './design'
import { Fade } from './kit'
import { at, type Drag, type Layout, type Rect } from './layout'
import type { Snapshot } from './table'

export function Piles({ snap, layout, drag }: { snap: Snapshot; layout: Layout; drag: Drag | null }) {
  const { deck, discard, size, pileCount, k } = layout
  const card = { w: size.stage, h: size.stage * Ratio }
  return (
    // The card width, for corners that match a card's exactly.
    <div className="overlay under" style={{ '--w': `${size.stage}px` } as CSSProperties}>
      {/* At the pace of the piles' own cards, so the deck's slices come and go with its top card. */}
      <Fade show={layout.resting} leave={Time.fade} wait={layout.stepAside}>
        {/* An empty pile shows its slot: the discard before its first card, the deck as its last one leaves. */}
        {snap.view.discard.length === 0 && <Zone {...discard} {...card} recess />}
        {pileCount === 0 && <Zone {...deck} {...card} recess />}
        <div className="edges" data-recede={!layout.drawable || undefined} style={at(deck.x, deck.y)}>
          {Array.from({ length: Math.min(Edges.most, Math.ceil((pileCount - 1) / Edges.per)) }, (_, i) => (
            <div
              key={i}
              style={{ width: card.w, height: card.h, transform: `translateY(${(i + 1) * Edges.step * k}px)`, zIndex: -i - 1 }}
            />
          ))}
        </div>
      </Fade>
      <Fade show={!!drag} enter={Time.micro}>
        {drag && <Zone {...layout.zones[drag.zone]} solid={drag.over} />}
      </Fade>
    </div>
  )
}

function Zone({ x, y, w, h, solid, recess }: Rect & { solid?: boolean; recess?: boolean }) {
  return <div className={recess ? 'zone well' : 'zone'} data-solid={solid || undefined} style={{ ...at(x, y), width: w, height: h }} />
}
