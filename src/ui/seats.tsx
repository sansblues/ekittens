import { useState, type CSSProperties } from 'react'
import { now } from './browser'
import { Hurry } from './design'
import { Avatar } from './avatar'
import { CardsIcon, Fit, Onward } from './kit'
import { at, type Layout } from './layout'
import { isMe, onTurn, shownAlive, shownHand, type Snapshot } from './table'
import { cardCount, nameOf } from './words'

export function Seats({ snap, layout }: { snap: Snapshot; layout: Layout }) {
  const turn = onTurn(snap)
  const { seats, order } = layout
  const avatar = layout.size.avatar
  const clock = snap.clock && !isMe(snap.view, snap.clock.seat) ? snap.clock : null
  // A name may be as wide as the space to the next seat, less a hair: a longer one fades out.
  const room = seats.length > 1 ? Math.abs(seats[1]!.x - seats[0]!.x) - 8 : null

  return (
    // Every mark as wide as the narrowest gap allows, so the row's marks match.
    <div className="overlay over" style={{ '--room': `${Math.min(...order.map((a) => a.room))}px` } as CSSProperties}>
      {order.map((a, i) => (
        <Onward key={i} style={{ ...at(a.x, a.y), rotate: `${a.angle}deg` }} />
      ))}
      {seats.map((seat) => {
        const alive = shownAlive(snap, seat.id)
        // Counted once the deal is done; still laid out, so the avatar and name never shift.
        const hidden = snap.beat?.t === 'deal' || !alive
        const held = shownHand(snap, seat.id).length
        return (
          <div
            key={seat.id}
            className="seat"
            data-out={!alive || undefined}
            // .seat centers on its point: the drop brings the avatar, not the whole column, about onto the seat.
            style={
              { ...at(seat.x, seat.y + avatar * 0.42), '--avatar': `${avatar}px`, ...(room && { '--room': `${room}px` }) } as CSSProperties
            }
          >
            {/* The same face as the lobby's: dealt in, it glides from there to here. */}
            <Avatar
              character={snap.cast[seat.id]!.face}
              size={avatar}
              out={!alive}
              sun={turn === seat.id}
              layoutId={`seat-${snap.cast[seat.id]!.face}`}
            />
            {clock?.near && clock.seat === seat.id && <Ring key={clock.ends} ends={clock.ends} />}
            <Fit className="name">{nameOf(snap, seat.id)}</Fit>
            <span className="n" data-hidden={hidden || undefined} aria-hidden={hidden || undefined} role="img" aria-label={cardCount(held)}>
              <CardsIcon />
              {held}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** The ring, just outside the face's edge, in its 100 units (the face's corner is 8, so the ring's is 9): from
 *  the top's middle, clockwise. Its length is 1, which CSS draws down. */
const Edge = 'M50 -1H92A9 9 0 0 1 101 8V92A9 9 0 0 1 92 101H8A9 9 0 0 1 -1 92V8A9 9 0 0 1 8 -1Z'

/** The last seconds of someone's move, drawn down around their face; started partway if it shows late. */
function Ring({ ends }: { ends: number }) {
  const [delay] = useState(() => Math.min(0, ends - Hurry.show - now()))
  return (
    <svg className="ring" viewBox="0 0 100 100" aria-hidden>
      <path d={Edge} pathLength={1} style={{ animationDelay: `${delay}s`, animationDuration: `${Hurry.show}s` }} />
    </svg>
  )
}
