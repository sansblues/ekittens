import type { CSSProperties, ReactNode } from 'react'
import type { Kind } from '../engine'
import { NamedWidth } from './design'
import { Deck, Mention, Meta } from './words'

export const art = (kind: Kind) => `/cards/${kind}.png`

export const Back = '/back-mark.svg'

const tint = (kind: Kind) => `var(--card-${kind})`

/** Without `width`, CSS sizes it by its --w. */
export function Card({ kind, width, className = '' }: { kind: Kind | null; width?: number; className?: string }) {
  const vars = { ...(width && { '--w': `${width}px` }), ...(kind && { '--c': tint(kind) }) } as CSSProperties
  if (!kind) {
    return (
      <div className={`card back ${className}`} style={vars}>
        <img className="mark" src={Back} alt="" draggable={false} />
      </div>
    )
  }
  return (
    <div className={`card face ${width && width < NamedWidth ? 'mini' : ''} ${className}`} style={vars}>
      {/* The art's alt names the card: the index would only say it twice. */}
      <div className="index" aria-hidden>
        <Emblem kind={kind} />
        <span>{Meta[kind].name}</span>
      </div>
      <img className="art" src={art(kind)} alt={Meta[kind].name} draggable={false} />
    </div>
  )
}

/** A null kind is the deck. */
export function CardTip({ kind, note }: { kind: Kind | null; note?: string | null }) {
  const { name, rule } = kind ? Meta[kind] : Deck
  return (
    <div className="cardtip">
      <div className="head">
        <Emblem kind={kind} />
        <b>{name}</b>
      </div>
      <p>
        <Named text={rule} />
      </p>
      {note && (
        <p className="why">
          <Named text={note} />
        </p>
      )}
    </div>
  )
}

/** The word before a card stays with it, so a line never ends on "a" with its card on the next. */
export function Named({ text }: { text: string }) {
  const out: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(Mention)) {
    const before = text.slice(at, m.index)
    const glued = /[\p{L}\p{N}'’]+ $/u.exec(before)?.[0] ?? ''
    out.push(before.slice(0, before.length - glued.length))
    const kind = m[1] as Kind
    out.push(
      <span key={m.index} className="named">
        {glued}
        <Emblem kind={kind} />
        {m[2] ?? Meta[kind].name}
      </span>,
    )
    at = m.index + m[0].length
  }
  out.push(text.slice(at))
  return out
}

/** One span, so a chip's gap never falls between the × and its number. */
export function Count({ n }: { n: number }) {
  return (
    <span>
      <span className="times">×</span>
      {n}
    </span>
  )
}

/** On a tile of the card's color, which the art's own circle melts into. */
export function Emblem({ kind }: { kind: Kind | null }) {
  return (
    <img
      className="emblem"
      src={kind ? art(kind) : Back}
      alt=""
      draggable={false}
      style={{ background: kind ? tint(kind) : 'var(--back)' }}
    />
  )
}
