import { AnimatePresence, motion } from 'motion/react'
import { Avatar } from './avatar'
import { Named } from './card'
import { Face, Spring, Time, tween } from './design'
import { Arrow, Draining, Fit, Swap, TimeLeft } from './kit'
import { at, type Layout } from './layout'
import { isMe, myClock, onTurn, type Snapshot } from './table'
import { byline, nameOf, pill, toPlain } from './words'

/** What a screen reader hears: what just happened, as the log tells it (a beat's line once it has played), then
 *  where things stand. Always there, and outside the table a sheet makes inert, so no line goes unsaid. */
export function Spoken({ snap, asking }: { snap: Snapshot; asking: boolean }) {
  const line = pill(snap)
  const last = snap.log.at(-1)
  const clock = myClock(snap)
  return (
    <>
      <p className="unseen" aria-live="polite">
        {/* A line of its own each time, so the same words twice (two draws under an Attack) are said twice. */}
        {last && <span key={last.id}>{toPlain(last.text)}</span>}
      </p>
      <p className="unseen" aria-live="polite">
        {line && !asking && !snap.beat && toPlain(line.text) + (line.turns ? `, ${line.turns} turns` : '')}
      </p>
      <p className="unseen" aria-live="polite">
        {clock && (
          <span key={clock.from}>{snap.clock?.near ? 'Time is almost up. Make a move to stay in the game.' : 'Your move is timed.'}</span>
        )}
      </p>
    </>
  )
}

export function Voice({ snap, layout, asking }: { snap: Snapshot; layout: Layout; asking: boolean }) {
  const { pill: spot, s } = layout
  const mine = isMe(snap.view, onTurn(snap))
  const line = pill(snap)
  const move = myClock(snap)
  const clock = line?.clock ?? move
  const text = line?.text ?? 'Your move'
  const who = byline(snap)
  return (
    <div className="overlay voice">
      <AnimatePresence>
        {who && !asking && (
          <motion.div
            key={`${who.from}-${who.to}`}
            className="byline"
            style={at(layout.byline.x, layout.byline.y)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: tween(Time.fade, Time.fade) }}
            exit={{ opacity: 0, transition: tween(Time.micro) }}
          >
            <Who snap={snap} id={who.from} size={Face.line * s} />
            {who.to !== undefined && (
              <>
                <Arrow />
                <Who snap={snap} id={who.to} size={Face.line * s} hit={who.hit} />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(line || move) && !asking && (
          <motion.div
            key="pill"
            className="pill"
            data-tone={line?.tone}
            style={at(spot.x, spot.y)}
            layout={move ? 'position' : true}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, transition: tween(Time.micro) }}
            transition={Spring.quick}
          >
            {clock && <Draining key={clock.from} {...clock} />}
            {/* Your avatar stays put for the whole turn; only the words cross-fade. */}
            <motion.div layout="position" className="line">
              {mine && <Avatar character={snap.cast[snap.view.me!]!.face} size={Face.line * s} sun />}
              <Swap id={text} aria-hidden>
                <Named text={text} />
              </Swap>
              {line?.turns && (
                <span className="turns" aria-hidden>
                  {line.turns} turns
                </span>
              )}
              {move && <TimeLeft key={move.from} ends={move.from + move.length} />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Who({ snap, id, size, hit }: { snap: Snapshot; id: number; size: number; hit?: boolean }) {
  return (
    <span className="who" data-hit={hit || undefined}>
      <Avatar character={snap.cast[id]!.face} size={size} />
      <Fit className="name">{nameOf(snap, id)}</Fit>
    </span>
  )
}
