import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createContext, Fragment, use, useEffect, useRef, useState, type ReactNode } from 'react'
import { Nameable, type Kind } from '../engine'
import { Avatar } from './avatar'
import { after, input, listen, now } from './browser'
import { Card, Named } from './card'
import { Face, Ratio, Rays, Spring, Time, tween } from './design'
import type { Game } from './game'
import { Fan, Spread, room } from './hand'
import { Guide } from './guide'
import {
  AgainIcon,
  BackIcon,
  CardsIcon,
  CheckIcon,
  CloseIcon,
  Draining,
  EyeIcon,
  Fade,
  Fit,
  HiddenIcon,
  HelpIcon,
  HistoryIcon,
  JoinIcon,
  LeaveIcon,
  Option,
  ShuffleIcon,
  SoundIcon,
  Swap,
  TimeLeft,
  Unbidden,
  useFresh,
} from './kit'
import { Invite } from './invite'
import { isMuted, setMuted } from './sound'
import { doneFor, groupHand, myClock, sheet, shownHand, targets, type Snapshot } from './table'
import { Meta, cardCount, depth, nameOf, ordinal, topCards, whose } from './words'

// Every choice is asked the same way: a sheet over the dimmed table. Cards still move by drag; picking is a tap.

/** A look over the running game, which never pauses it: the menu (or its Leave step), the log, or the rules. */
export type Look = 'menu' | 'leave' | 'log' | 'rules' | null

type Which = NonNullable<ReturnType<typeof sheet> | Look>

interface Props {
  game: Game
  snap: Snapshot
  /** Yours, for someone watching: they have no seat to take it from. */
  face: number
  setLook: (look: Look) => void
  onLeave: () => void
  onAgain: () => void
  /** Watching from the link, once the game ends: a seat's free, take it. */
  onJoin?: () => void
  /** With friends: the room's link, which the menu shares. */
  link?: string
  /** With friends, while the game is on: out of it, you may watch to the end. */
  watchable?: boolean
}

/** A play not yet made can be backed out of, and a look closed; what the game asks can't be put off. */
const Drafts: Which[] = ['size', 'target', 'name']
const Looks: Which[] = ['menu', 'leave', 'log', 'rules']

export function Sheets({ which, ...props }: Props & { which: Which | null }) {
  const { game, snap, setLook } = props
  const clock = myClock(snap)
  const cancel =
    which === 'future'
      ? () => game.dismissFuture()
      : which && Drafts.includes(which)
        ? () => game.cancelDraft()
        : which && Looks.includes(which)
          ? () => setLook(null)
          : null
  // The step the sheet rose with, from no sheet: it comes up under the press that asked for it.
  const [shown, setShown] = useState({ which, rose: which })
  if (shown.which !== which) setShown({ which, rose: shown.which === null ? which : shown.rose })
  // It rises from the bottom edge; with reduced motion it just fades in where it rests.
  const reduce = useReducedMotion()
  const away = reduce ? { x: '-50%', opacity: 0 } : { x: '-50%', y: '110%' }

  useEffect(() => {
    if (cancel) return listen(window, 'keydown', (e) => e.key === 'Escape' && cancel())
  }, [which]) // what it does depends on the sheet alone

  // A new sheet takes the focus: by keyboard, on its main action or first option, so Enter does the
  // expected thing; otherwise on the sheet itself, so no ring shows on a button nobody pointed at.
  useEffect(() => {
    if (!which) return
    // Once this step's contents are in (the last step may still be fading out beside it).
    return after(Time.mount, () => {
      const step = document.querySelector(`.sheet [data-step="${which}"]`)
      // Never a card to give: an Enter by reflex would give the first, a Defuse.
      const first =
        which === 'give' ? null : (step?.querySelector<HTMLElement>('.option.primary') ?? step?.querySelector<HTMLElement>('button'))
      ;((input() === 'key' && first) || document.querySelector<HTMLElement>('.sheet'))?.focus({ preventScroll: true })
    })
  }, [which])

  // When the sheets are done, the focus goes back where it was, if that's still there. It's noted as
  // it happens, because the table turns inert (and drops it) as a sheet opens.
  const back = useRef<HTMLElement | null>(null)
  useEffect(
    () =>
      listen(document, 'focusin', (e) => {
        if (e.target instanceof HTMLElement && !e.target.closest('.sheet')) back.current = e.target
      }),
    [],
  )
  const open = which !== null
  useEffect(() => {
    // The sheet is still leaving with its button focused, or it has gone and the focus with it.
    const lost = document.activeElement === document.body || !!document.activeElement?.closest('.sheet')
    const el = back.current
    if (open || !lost || !el) return
    // The card that opened it may be on the stage by now, out of reach: then the menu button takes it.
    const reachable = el.isConnected && el.tabIndex >= 0
    ;(reachable ? el : document.querySelector<HTMLElement>('.corner button'))?.focus({ preventScroll: true })
  }, [open])

  const Step = which && Steps[which]
  return (
    <>
      <Scrim show={!!Step} onCancel={cancel} />
      <AnimatePresence>
        {Step && (
          <motion.section
            key="sheet"
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${which}-title`}
            tabIndex={-1}
            layout
            initial={away}
            animate={{ x: '-50%', y: 0, opacity: 1 }}
            exit={away}
            transition={reduce ? tween(Time.fade) : Spring.quick}
            // A key still held from what raised the sheet repeats onto its focused button: only a fresh press chooses.
            onKeyDown={(e) => e.repeat && (e.key === 'Enter' || e.key === ' ') && e.preventDefault()}
          >
            {/* The same clock continues while the sheet hides the pill. */}
            {clock && (
              <Fragment key={clock.from}>
                <Draining {...clock} />
                <TimeLeft ends={clock.from + clock.length} />
              </Fragment>
            )}
            {/* One step's contents cross-fade into the next's. As the sheet grows or shrinks to fit them,
                they keep their true shape: Motion undoes the sheet's stretch on them. */}
            <Swap id={which} data-step={which} layout="position">
              <Title value={which}>
                {/* What the game asks of you, or its end, rises unasked, and so does a play's first question, under
                    the press that played it (a double tap would answer it); its next, or a look you opened, doesn't. */}
                <Unbidden value={!Looks.includes(which) && (!Drafts.includes(which) || shown.rose === which)}>
                  <Step {...props} />
                </Unbidden>
              </Title>
            </Swap>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}

/** It backs out only when the press began on it, and not in its first moment: the click that ends the tap which
 *  opened a sheet (a Favor, a cat combo) lands on the scrim rising under the finger, and so does a double click's
 *  second press. */
function Scrim({ show, onCancel }: { show: boolean; onCancel: (() => void) | null }) {
  const pressed = useRef(false)
  const since = useRef(0)
  useEffect(() => {
    if (show) since.current = now()
  }, [show])
  // Every press starts clean, so one that slid off the scrim never counts for the next sheet.
  useEffect(() => listen(window, 'pointerdown', () => (pressed.current = false), true), [])
  return (
    <Fade
      show={show}
      className="scrim"
      onPointerDown={() => (pressed.current = now() - since.current >= Time.fresh)}
      onClick={() => {
        if (pressed.current) onCancel?.()
        pressed.current = false
      }}
    />
  )
}

/** The step showing, so its title can name the sheet (aria-labelledby). */
const Title = createContext<string>('')

/** `lead`: beside the title, what it's about: the card played, or the winner crowned. */
function Head({ title, sub, lead }: { title: string; sub?: string; lead?: ReactNode }) {
  const step = use(Title)
  return (
    <div className="head">
      {lead}
      <div>
        <h2 id={`${step}-title`}>
          <Named text={title} />
        </h2>
        {sub && (
          <p className="sub">
            <Named text={sub} />
          </p>
        )}
      </div>
    </div>
  )
}

const Thumb = ({ kind }: { kind?: Kind }) => kind && <Card kind={kind} className="thumb" />

/** Room for the sun's rays, so they touch neither the sheet's edge nor the title. */
function Crowned({ character }: { character: number }) {
  const size = room() < 400 ? Face.seat : Face.crown
  return (
    <span className="crowned" style={{ margin: size * Rays }}>
      <Avatar character={character} size={size} sun />
    </span>
  )
}

/** The winner, crowned, to whoever won or watched it end; to you just gone out, how. */
function End({ game, snap, onLeave, onAgain, onJoin, link, watchable }: Props) {
  const { view, cast, watching } = snap
  const { me, phase } = view
  const kitten = me !== null && view.players[me]!.kitten
  const out = me !== null && !view.players[me]!.alive
  // Out as it ended: who won, said after how.
  const won = phase.t === 'over' ? ` ${nameOf(snap, phase.winner)} won.` : ''
  const head =
    phase.t === 'over' && (!out || watching) ? (
      <Head title={`${nameOf(snap, phase.winner)} won`} lead={<Crowned character={cast[phase.winner]!.face} />} />
    ) : kitten ? (
      <Head title="Boom" sub={`The {exploding-kitten} got you.${won}`} />
    ) : (
      <Head title="Time’s up" sub={`You’re out of this game.${won}`} />
    )
  const watch = watchable && phase.t !== 'over'
  // Against bots, a new game at once. With friends, back to the room, where anyone deals the next; someone who only
  // watched joins it from here, if a seat's free.
  const back = !!link || me === null
  return (
    <>
      {head}
      <div className="row">
        <Option onClick={onLeave}>
          <LeaveIcon />
          Leave
        </Option>
        <Option primary onClick={watch ? () => game.watch(true) : (onJoin ?? onAgain)}>
          {watch ? <EyeIcon /> : onJoin ? <JoinIcon /> : back ? <BackIcon /> : <AgainIcon />}
          {watch ? 'Watch' : onJoin ? 'Join the game' : back ? 'Back to the room' : 'Play again'}
        </Option>
      </div>
    </>
  )
}

/** px: the screen's height that isn't the Peek's cards: the gutters, the sheet's padding, its title, gaps and
 *  button (measured, so a short screen fits it whole; scripts/shots.mjs checks). */
const PeekRest = 232

function Future({ game, snap }: Props) {
  if (snap.beat?.t !== 'future') return null
  const { cards } = snap.beat
  // Three across, with their two gaps and room for the tilted ends; on a short screen, as tall as leaves the rest
  // of the sheet in view (PeekRest).
  const width = Math.min(142, Math.floor((room() - 2 * 12 - 16) / 3), Math.floor((innerHeight - PeekRest) / Ratio))
  return (
    <>
      <Head title={topCards(cards.length)} />
      <div className="picks peek">
        {cards.map((c, i) => (
          <div key={c.id} className="pick">
            <span className="badge order">{i === 0 ? 'Top' : ordinal(i + 1)}</span>
            <Card kind={c.kind} width={width} />
          </div>
        ))}
      </div>
      <Option primary onClick={() => game.dismissFuture()}>
        <CheckIcon />
        Got it
      </Option>
    </>
  )
}

function Size({ game, snap }: Props) {
  return (
    <>
      {/* Digits, like the options' own numbers it asks between. */}
      <Head title="Play 2 or 3?" lead={<Thumb kind={snap.draft?.cards[0]?.kind} />} />
      <div className="options">
        <Option onClick={() => game.chooseSize(2)}>
          <span className="num">2</span> Steal a random card
        </Option>
        <Option onClick={() => game.chooseSize(3)}>
          <span className="num">3</span> Name the card you want
        </Option>
        <Cancel game={game} />
      </div>
    </>
  )
}

function Target({ game, snap }: Props) {
  const kind = snap.draft?.cards[0]?.kind
  return (
    <>
      <Head title={kind === 'favor' ? 'Who do you ask for a {favor}?' : 'Who do you steal from?'} lead={<Thumb kind={kind} />} />
      <div className="options">
        {targets(snap.view).map((id) => (
          <Option key={id} onClick={() => game.chooseTarget(id)}>
            <Avatar character={snap.cast[id]!.face} size={Face.option} />
            <Fit className="who">{nameOf(snap, id)}</Fit>
            <span className="note" role="img" aria-label={cardCount(shownHand(snap, id).length)}>
              <CardsIcon />
              {shownHand(snap, id).length}
            </span>
          </Option>
        ))}
        <Cancel game={game} />
      </div>
    </>
  )
}

function Name({ game, snap }: Props) {
  const { draft } = snap
  const fresh = useFresh()
  if (draft?.step !== 'name') return null
  return (
    <>
      <Head
        title="Name the card you want"
        sub={`If ${nameOf(snap, draft.target)} has one, it’s yours.`}
        lead={<Thumb kind={draft.cards[0]!.kind} />}
      />
      <div className="picks names">
        {Nameable.map((k) => (
          <button key={k} className="pick" onClick={fresh(() => game.chooseName(k))} aria-label={Meta[k].name}>
            <Card kind={k} />
          </button>
        ))}
      </div>
      <Cancel game={game} />
    </>
  )
}

function Pick({ game, snap }: Props) {
  const ph = snap.view.phase
  if (ph.t !== 'steal') return null
  return (
    <>
      <Head title="Pick a card" sub={`From ${whose(snap, ph.victim)} hand.`} />
      <Spread count={snap.view.players[ph.victim]!.cards} onPick={(i) => game.pick(i)} />
    </>
  )
}

function Give({ game, snap }: Props) {
  const ph = snap.view.phase
  if (ph.t !== 'favor') return null
  return (
    <>
      <Head title={`${nameOf(snap, ph.to)} asks for a {favor}`} sub="Pick a card to give them." />
      <Fan groups={groupHand(snap.view.hand)} onPick={(g) => game.give(g[0]!)} />
    </>
  )
}

/** It starts at the bottom, the one place that never costs you (you may still owe a turn). */
function Place({ game, snap }: Props) {
  const size = snap.view.deck
  // The deck may shrink under it, as someone leaves with a kitten.
  const [picked, setIndex] = useState(size)
  const index = Math.min(picked, size)
  const label = depth(index, size)
  return (
    <>
      <Head title="Hide the {exploding-kitten}" sub="Only you will know where." />
      {/* The slider says it to a screen reader. */}
      <p className="place-label" aria-hidden>
        {label}
      </p>
      <input
        className="deck-slider"
        type="range"
        max={size}
        value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
        aria-label="Where in the deck"
        aria-valuetext={label}
      />
      <div className="row">
        <Option onClick={() => game.hide()}>
          <ShuffleIcon />
          At random
        </Option>
        <Option primary onClick={() => game.hide(index)}>
          <HiddenIcon />
          Hide it
        </Option>
      </div>
    </>
  )
}

function Log({ snap, setLook }: Props) {
  return (
    <>
      <Head title="What happened" />
      <ol className="log">
        {snap.log.length === 0 && <li className="none">Nothing yet</li>}
        {snap.log.toReversed().map((l) => (
          <li key={l.id}>
            <Avatar character={snap.cast[l.who]!.face} size={Face.line} />
            <span>
              <Named text={l.text} />
            </span>
          </li>
        ))}
      </ol>
      <Back setLook={setLook} />
    </>
  )
}

function Menu({ setLook, link }: Props) {
  const [sound, setSound] = useState(() => !isMuted())
  const toggle = () => {
    setMuted(sound)
    setSound(!sound)
  }
  return (
    <>
      <Head title="Menu" />
      <div className="options menu">
        {link && <Invite link={link} />}
        <Option onClick={() => setLook('rules')}>
          <HelpIcon />
          How to play
        </Option>
        <Option onClick={() => setLook('log')}>
          <HistoryIcon />
          What happened
        </Option>
        <Option onClick={toggle}>
          <SoundIcon on={!sound} />
          {sound ? 'Turn sound off' : 'Turn sound on'}
        </Option>
        <Option onClick={() => setLook('leave')}>
          <LeaveIcon />
          Leave the game
        </Option>
        <Back setLook={setLook} />
      </div>
    </>
  )
}

function Rules({ snap, face, setLook }: Props) {
  return (
    <>
      <Head title="How to play" />
      <Guide face={snap.view.me === null ? face : snap.cast[snap.view.me]!.face} />
      <Back setLook={setLook} />
    </>
  )
}

/** Stay is the main, safe answer. */
function Leave({ snap, setLook, onLeave }: Props) {
  return (
    <>
      <Head
        title="Leave the game?"
        sub={doneFor(snap.view) || snap.view.me === null ? 'You’ll stop watching.' : 'You can’t come back to it.'}
      />
      <div className="row">
        <Option onClick={onLeave}>
          <LeaveIcon />
          Leave
        </Option>
        <Option primary onClick={() => setLook(null)}>
          <BackIcon />
          Stay
        </Option>
      </div>
    </>
  )
}

/** A play not yet made, backed out of. */
function Cancel({ game }: Pick<Props, 'game'>) {
  return (
    <Option onClick={() => game.cancelDraft()}>
      <CloseIcon />
      Cancel
    </Option>
  )
}

/** A look closed, the table back in view. */
function Back({ setLook }: Pick<Props, 'setLook'>) {
  return (
    <Option primary onClick={() => setLook(null)}>
      <BackIcon />
      Back to the game
    </Option>
  )
}

const Steps = {
  end: End,
  future: Future,
  size: Size,
  target: Target,
  name: Name,
  pick: Pick,
  give: Give,
  place: Place,
  log: Log,
  menu: Menu,
  leave: Leave,
  rules: Rules,
}
