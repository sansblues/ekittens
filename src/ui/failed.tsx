import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Component, useEffect, useRef, type ReactNode } from 'react'
import { asCode } from '../lobby'
import { forget, forgetRoom, input, listen, recently } from './browser'
import { Card } from './card'
import { Spring, Time, tween } from './design'
import { stopAll } from './game'
import { AgainIcon, CheckIcon, Fade, Option, Unbidden } from './kit'

// What can't be helped, on the game's own sheet: a link to a room with no game, over home; a bug, alone in the
// middle, since what broke can't be drawn behind it.

/** Any bug that breaks the screen. Every game on it stops, and Reload puts you back where you were; broken again
 *  within a minute, what you were in (a saved game, a room) may be what breaks it, so it's let go first: Reload
 *  always gets you somewhere. */
export class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    stopAll()
    if (!recently('broke')) return
    forget('game')
    const code = asCode(location.pathname.slice(1))
    if (code) forgetRoom(code)
    else forget('playing')
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="told alone">
        <Told show lead={<Card kind="exploding-kitten" className="thumb" />} title="Something broke" sub="Reload to carry on.">
          <Option primary onClick={() => location.reload()}>
            <AgainIcon />
            Reload
          </Option>
        </Told>
      </main>
    )
  }
}

/** A link to a room with no game (it ended: an empty room is forgotten after a day; or it's mistyped): you're
 *  home, and the sheet over it says so. */
export function NoGame({ show, onClose }: { show: boolean; onClose: () => void }) {
  // First, before the page's own Escape (a game's menu) hears it.
  useEffect(() => {
    if (!show) return
    return listen(
      window,
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return
        e.stopImmediatePropagation()
        onClose()
      },
      true,
    )
  }, [show])
  return (
    <>
      <Fade show={show} className="scrim told" onClick={onClose} />
      <Told show={show} title="No game here" sub="It has ended, or the link isn’t quite right.">
        <Option primary onClick={onClose}>
          <CheckIcon />
          Got it
        </Option>
      </Told>
    </>
  )
}

/** The game's sheet: it rises, takes the focus as the game's do (its button by keyboard, else itself), and holds
 *  what happened and the way on. */
function Told({ show, lead, title, sub, children }: { show: boolean; lead?: ReactNode; title: string; sub: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  const sheet = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = sheet.current
    if (show && el) (input() === 'key' ? el.querySelector<HTMLElement>('.primary') : el)?.focus({ preventScroll: true })
  }, [show])
  const away = reduce ? { opacity: 0 } : { y: '110%' }
  return (
    <AnimatePresence>
      {show && (
        <motion.section
          ref={sheet}
          className="sheet told"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="told-title"
          aria-describedby="told-sub"
          tabIndex={-1}
          initial={away}
          animate={{ y: 0, opacity: 1 }}
          exit={away}
          transition={reduce ? tween(Time.fade) : Spring.quick}
        >
          <div className="head">
            {lead}
            <div>
              <h2 id="told-title">{title}</h2>
              <p id="told-sub" className="sub">
                {sub}
              </p>
            </div>
          </div>
          {/* It rises unasked: a press meant for what was under it never answers it. */}
          <div className="row">
            <Unbidden value>{children}</Unbidden>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
