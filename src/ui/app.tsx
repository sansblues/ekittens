import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { waitingOn } from '../engine'
import { Characters, arrive, asCode, clip, facesAfter, nameFor, newCode, type Table } from '../lobby'
import { after, joinedRoom, listen, load, save } from './browser'
import { Flush, Slam, Time, tween } from './design'
import { Game, stopAll } from './game'
import { IconButton, MenuIcon } from './kit'
import { Layer } from './layer'
import { place, type Drag } from './layout'
import { Lobby } from './lobby'
import { NoGame } from './failed'
import { Start } from './start'
import { Online, type Heard, type Line } from './online'
import { Piles } from './piles'
import { Seats } from './seats'
import { Sheets, type Look } from './sheets'
import { sfx } from './sound'
import { ended, isMe, sheet, threat } from './table'
import { Tip } from './tip'
import { Spoken, Voice } from './voice'

/** Random the first time, then kept, so you always know which one is you. */
function myCharacter(): number {
  const saved = load('character')
  if (typeof saved === 'number' && Characters[saved]) return saved
  const me = Math.floor(Math.random() * Characters.length)
  save('character', me)
  return me
}

/** The name you gave; empty, you go by your nickname. */
const myName = () => {
  const saved = load('name')
  return typeof saved === 'string' ? clip(saved).trim() : ''
}

/** Yours until you give your name, picked once and kept: plainly a player's default name, never a card's.
 *  None of the numbers that read as a joke. */
const Nick = /^Player[1-9]\d\d$/
function myNick(): string {
  const saved = load('nick')
  if (typeof saved === 'string' && Nick.test(saved)) return saved
  let n: number
  do n = 100 + Math.floor(Math.random() * 900)
  while (n === 420 || n === 666 || String(n).includes('69'))
  const nick = `Player${n}`
  save('nick', nick)
  return nick
}

/** Who friends see: your name, or your nickname. */
const goBy = () => myName() || myNick()

/** Against bots, a table of four: the three faces after yours. */
const botsFor = (me: number) => facesAfter(me).slice(0, 3)

/** This device's secret in every room: it takes your seat back after a reload. */
function myKey(): string {
  const saved = load('key')
  if (typeof saved === 'string' && saved.length >= 16) return saved
  const key = crypto.randomUUID()
  save('key', key)
  return key
}

/** The room an address names, if any, whatever a chat app added around its code: a slash, a space. */
const roomAt = (path: string) => asCode(path.replace(/%[0-9a-f]{2}|[^0-9a-z]/gi, ''))

/** A room's link is its code, written as it should be however it was typed; the plain address leads back into
 *  a game you're in, while it's on. Any other address is home's. */
function firstPath(): string {
  const saved = load('playing')
  const room = location.pathname === '/' ? (typeof saved === 'string' ? asCode(saved) : null) : roomAt(location.pathname)
  const path = room ? `/${room}` : '/'
  // Kept: the mark that home is the step behind (see `open`).
  if (path !== location.pathname) history.replaceState(history.state, '', path)
  return path
}

export function App() {
  const [path, setPath] = useState(firstPath)
  const [face, setFace] = useState(myCharacter)
  const turn = (next: number) => {
    setFace(next)
    save('character', next)
  }
  const [name, setName] = useState(myName)
  const [nick] = useState(myNick)
  const rename = (next: string) => {
    setName(next)
    save('name', next)
  }
  // A room this screen opens: it shows at once, as the room will tell it, while the room opens.
  const [opening, setOpening] = useState<Opening | null>(null)
  // A link with no game, said over home until you've seen it.
  const [gone, setGone] = useState(false)
  useEffect(
    () =>
      listen(window, 'popstate', () => {
        setGone(false)
        setPath(location.pathname)
      }),
    [],
  )
  /** A new room, under a code of this screen's picking; `again`, in place of one whose code was taken. It goes on
   *  top of home, marked so that leaving goes back to it: Back then never meets home twice. */
  const open = (again = false) => {
    const code = newCode()
    setOpening({ code, lobby: { t: 'lobby', people: [{ name: nameFor(goBy(), face), face, you: true }], bots: [], playing: false } })
    if (again) history.replaceState(history.state, '', `/${code}`)
    else history.pushState({ home: true }, '', `/${code}`)
    setPath(`/${code}`)
  }
  /** Home again: back to it when it's the step behind, else in the room's place. `gone` always takes its place:
   *  going back would put away the sheet that says there's no game. */
  const leave = (gone: boolean) => {
    setGone(gone)
    setOpening(null)
    if (history.state?.home && !gone) history.back()
    else history.replaceState(null, '', '/')
    setPath('/')
  }
  const code = roomAt(path)
  // A game against bots plays only while home shows it: off to a room, it stops, saved, and picks up on your return.
  useEffect(() => {
    if (code) stopAll()
  }, [code])
  if (code)
    return (
      <Room
        key={code}
        code={code}
        face={face}
        onFace={turn}
        name={name}
        nick={nick}
        onName={rename}
        opening={opening?.code === code ? opening : undefined}
        onTaken={() => open(true)}
        onLeave={(gone) => leave(!!gone)}
      />
    )
  return (
    <>
      {/* Behind the sheet that says a link had no game, home can't be reached. */}
      <div className="board" inert={gone}>
        <Solo face={face} onFace={turn} name={name} nick={nick} onName={rename} onFriends={() => open()} />
      </div>
      <NoGame show={gone} onClose={() => setGone(false)} />
    </>
  )
}

/** A room this screen opens: its lobby as it will be told. */
interface Opening {
  code: string
  lobby: Heard
}

/** A game against bots, in this tab; a room with friends is a tap away. */
function Solo({
  face,
  onFace,
  name,
  nick,
  onName,
  onFriends,
}: {
  face: number
  onFace: (face: number) => void
  name: string
  nick: string
  onName: (name: string) => void
  onFriends: () => void
}) {
  const [game, setGame] = useState<Game | null>(() => Game.resume())

  const start = (faces: number[]) => {
    game?.dispose()
    setGame(Game.start(face, faces))
  }
  const leave = () => {
    game?.abandon()
    setGame(null)
  }

  return game ? (
    <Play
      key={game.id}
      game={game}
      face={face}
      onAgain={() => {
        const bots = game.snap.cast.filter((_, id) => id !== game.me).map((s) => s.face)
        // Your face may have changed since (with friends): no bot may wear it too.
        start(bots.includes(face) ? botsFor(face) : bots)
      }}
      onLeave={leave}
    />
  ) : (
    <Start face={face} onFace={onFace} name={name} nick={nick} onName={onName} ways={{ onPlay: () => start(botsFor(face)), onFriends }} />
  )
}

/** A room with friends: its lobby, or its game. */
interface RoomProps {
  code: string
  face: number
  onFace: (face: number) => void
  name: string
  nick: string
  onName: (name: string) => void
  opening?: Opening
  /** The room this screen opened has a code someone else's has: it opens another. */
  onTaken: () => void
  /** `gone`: there's no game at the link. */
  onLeave: (gone?: boolean) => void
}

/** Who you are to a room, read from storage at once: a name just typed is in it. */
const hello = () => ({ key: myKey(), name: goBy(), face: myCharacter() })

function Room(props: RoomProps) {
  const { code, opening, onLeave } = props
  // A friend's link first asks who you are; the screen that opened the room, or one back in it, is in.
  const [joined, setJoined] = useState(() => !!opening || joinedRoom(code))
  // From Join until the room speaks, the lobby as it will most likely be: as this screen opened it, or as the
  // link last showed it, with you seated as the room will seat you. So there's no blank frame.
  const [heard, setHeard] = useState<Heard | null>(opening?.lobby ?? null)
  // One line to the room, from a friend's link on: it shows the table live, and joining speaks on it; a room this
  // screen opens, it opens first. Opened by an effect, so a render React throws away never leaves one open.
  const [online, setOnline] = useState<Online | null>(null)
  useEffect(() => {
    const line = new Online(code, joined ? hello() : null, !!opening)
    setOnline(line)
    return () => line.close()
  }, [code]) // one line per room
  const line: Line = useSyncExternalStore(online?.subscribe ?? quiet, () => online?.line ?? Unheard)
  // A link to a room with no game goes home, which says so; a code that turned out taken is swapped for a fresh one.
  useEffect(() => {
    if (line.status === 'gone') onLeave(true)
    if (line.status === 'taken') props.onTaken()
  }, [line.status])

  // Turned away (the last seat went as you pressed Join): back to the link, live, until one frees.
  const inside = joined && (!line.lobby || line.lobby.people.some((p) => p.you))
  const join = () => {
    const you = hello()
    setHeard(line.lobby && guess(line.lobby, you.face, you.name))
    online?.join(you)
    setJoined(true)
  }
  // At the link, the game on is watched, to its end; the end put away (or the game no longer on, unseen to its
  // end, the line down), the link shows again.
  const [seen, setSeen] = useState<number | null>(null)
  const watched = !inside && line.game && line.game.deal !== seen ? line.game : null
  useEffect(() => {
    if (watched && line.lobby && !line.lobby.playing && watched.snap.view.phase.t !== 'over') setSeen(watched.deal)
  }, [line.lobby])
  if (watched)
    return (
      <Play
        key={watched.id}
        game={watched}
        face={props.face}
        onAgain={() => setSeen(watched.deal)}
        // A seat free once it ends: straight in, for the next.
        onJoin={line.lobby && line.lobby.people.length < Characters.length ? join : undefined}
        onLeave={() => {
          online?.leave()
          onLeave()
        }}
        link={`${location.origin}/${code}`}
        spectator
      />
    )
  if (!inside)
    return (
      <Start
        face={props.face}
        onFace={props.onFace}
        name={props.name}
        nick={props.nick}
        onName={props.onName}
        ways={{ table: line.lobby, onJoin: join, onLeave: () => onLeave() }}
      />
    )
  return (
    <Here
      online={online}
      line={line}
      code={code}
      face={props.face}
      heard={heard}
      onBots={(bots) => setHeard((h) => h && { ...h, bots })}
      onLeave={onLeave}
    />
  )
}

/** The lobby a friend's link last showed, with you seated as the room will seat you. */
function guess(table: Table, face: number, name: string): Heard {
  const seen = { people: table.people.map((p, i) => ({ ...p, key: `${i}` })), bots: table.bots }
  const { people, bots } = arrive(seen, '', name, face)
  const told = people.map((p) => ({ name: p.name, face: p.face, you: p.key === '' }))
  return { t: 'lobby', people: told, bots, playing: table.playing }
}

/** Nothing heard yet. */
const Unheard: Line = { status: 'connecting', lobby: null, game: null }
const quiet = () => () => {}

type HereProps = Pick<RoomProps, 'code' | 'face' | 'onLeave'> & {
  online: Online | null
  line: Line
  heard: Heard | null
  /** Bots picked before the room has spoken: this screen's guess wears them meanwhile. */
  onBots: (faces: number[]) => void
}

function Here({ online, line, code, face, heard, onBots, onLeave }: HereProps) {
  const { status, game } = line
  // Until the room speaks, it shows as it will most likely be: as this screen opened it, or as its link saw it.
  const lobby = line.lobby ?? heard
  useDoorbell(line.lobby)
  // The end sheet you closed: the room's lobby shows until the next game is dealt.
  const [closed, setClosed] = useState<number | null>(null)
  // A game no longer on ends for everyone at it: one that's over shows who won; out and watching, your end shows;
  // only watching (the last person went out, and the bots' game stops there), the room does. Only the room can say
  // so: this screen's guess can't know a game was dealt as you joined.
  useEffect(() => {
    const told = line.lobby
    if (!told || told.playing || !game || game.snap.view.phase.t === 'over') return
    if (game.snap.view.me === null) setClosed(game.id)
    else game.watch(false)
  }, [game, line.lobby])
  const leave = () => {
    online?.leave()
    onLeave()
  }
  const link = `${location.origin}/${code}`

  if (game && (lobby?.playing || game.id !== closed))
    return (
      <Play
        key={game.id}
        game={game}
        face={face}
        onAgain={() => {
          online?.acknowledge(game.deal)
          setClosed(game.id)
        }}
        onLeave={leave}
        link={link}
        watchable={!!lobby?.playing}
      />
    )
  // Back in a room after a reload, before it has spoken, its seats are still empty.
  return (
    <Lobby
      people={lobby?.people ?? []}
      bots={lobby?.bots ?? []}
      onBots={
        lobby
          ? (faces) => {
              online?.bots(faces)
              if (!line.lobby) onBots(faces)
            }
          : undefined
      }
      onPlay={() => online?.play()}
      link={link}
      wait={status === 'open' ? undefined : line.lobby ? 'Reconnecting…' : 'Connecting…'}
      onLeave={leave}
    />
  )
}

/** Someone new sits down at your table between games: a doorbell, heard from another tab too, whose title then
 *  says who came until you're back. Not for who was here before the room spoke, nor for who sits down mid-game. */
function useDoorbell(told: Heard | null) {
  const seen = useRef<Heard['people'] | null>(null)
  const called = useRef(false)
  useEffect(() => {
    const others = told && !told.playing ? told.people.filter((p) => !p.you) : null
    const before = seen.current
    seen.current = others
    const came = before && others?.find((p) => !before.some((b) => b.face === p.face && b.name === p.name))
    if (!came) return
    sfx('join')
    if (!document.hidden) return
    document.title = `${came.name} joined · Exploding Kittens`
    called.current = true
  }, [told])
  useEffect(() => {
    const back = () => {
      if (!called.current) return
      called.current = false
      document.title = 'Exploding Kittens'
    }
    const off = listen(document, 'visibilitychange', () => !document.hidden && back())
    return () => {
      off()
      back()
    }
  }, [])
}

interface PlayProps {
  game: Game
  /** Yours, for the rules' picture of you winning, while you watch. */
  face: number
  onAgain: () => void
  onLeave: () => void
  /** With friends: the room's link, which the menu shares. */
  link?: string
  /** With friends, while the game is on: out of it, you may watch to the end. */
  watchable?: boolean
  /** Watching from the link, with no seat. */
  spectator?: boolean
  /** Watching from the link, once the game ends: a seat's free, take it. */
  onJoin?: () => void
}

function Play({ game, face, onAgain, onJoin, onLeave, link, watchable, spectator }: PlayProps) {
  const snap = useSyncExternalStore(game.subscribe, () => game.snap)
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [look, setLook] = useState<Look>(null)
  const [flinch, setFlinch] = useState(false)

  // A hover lasts while the table stands still. A tapped card that left and came back (a kitten hidden
  // on top of the deck) must not rise again, or it would tell where the kitten went.
  const [hoverIn, setHoverIn] = useState(snap.view)
  if (hoverIn !== snap.view) {
    setHoverIn(snap.view)
    setHover(null)
  }

  useEffect(() => listen(window, 'resize', () => setSize({ w: window.innerWidth, h: window.innerHeight })), [])

  // Seen from another tab, too: the game waits on you.
  const yours = isMe(snap.view, waitingOn(snap.view))
  useEffect(() => {
    document.title = yours ? 'Your move · Exploding Kittens' : 'Exploding Kittens'
    return () => void (document.title = 'Exploding Kittens')
  }, [yours])

  // The screenshots (scripts/shots.mjs) drive the game through it.
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { game })
  }, [game])

  // Choices wait behind a look you opened. The end replaces it, so you see why play stopped.
  const threatened = threat(snap)
  const asked = sheet(snap)
  if (asked === 'end' && look) setLook(null)
  const which = asked === 'end' ? asked : (look ?? asked)

  // Escape opens the menu, over what the game asks of you too (it waits); a sheet of your own it closes
  // (sheets.tsx), and at the end, the end's own sheet holds the way out.
  const menuable = !look && (asked === null || asked === 'give' || asked === 'pick' || asked === 'place')
  useEffect(() => {
    if (menuable) return listen(window, 'keydown', (e) => e.key === 'Escape' && !e.repeat && setLook('menu'))
  }, [menuable])

  useEffect(() => {
    if (threatened === null) return
    setFlinch(true)
    const stop = after(Time.flinch, () => setFlinch(false))
    return () => {
      stop()
      setFlinch(false)
    }
  }, [threatened])

  const layout = place(snap, { ...size, drag, hover, flinch })
  const flush = snap.beat?.t === 'boom' ? 'boom' : layout.cards.some((p) => p.slam) ? 'kitten' : null

  return (
    <main
      className="table"
      // A tap off the cards puts away a tapped card's tip.
      onPointerDown={(e) => e.pointerType !== 'mouse' && !(e.target as Element).closest('.slotted') && setHover(null)}
      // A right click or a long press opens no menu to save a card's picture; a field (the room's link) keeps its own.
      onContextMenu={(e) => !(e.target instanceof HTMLInputElement) && e.preventDefault()}
      data-dragging={!!drag || undefined}
      data-spotlight={layout.spotlight || undefined}
      data-compact={layout.compact || undefined}
      style={{ '--s': layout.s } as CSSProperties}
    >
      <AnimatePresence>{flush && <Lights key={flush} kind={flush} />}</AnimatePresence>
      {/* While a sheet shows, the table behind it can't be reached, not even by keyboard. */}
      <div className="board" inert={!!which}>
        {/* First in the page, as it's first to the eye: the keyboard reaches the menu before the cards. */}
        <div className="corner">
          <IconButton label="Menu" aria-keyshortcuts="Escape" onClick={() => setLook('menu')}>
            <MenuIcon />
          </IconButton>
        </div>
        <Piles snap={snap} layout={layout} drag={drag} />
        <Layer
          game={game}
          snap={snap}
          layout={layout}
          drag={drag}
          setDrag={setDrag}
          hover={hover}
          setHover={setHover}
          onLog={() => setLook('log')}
        />
        <Seats snap={snap} layout={layout} />
        <Voice snap={snap} layout={layout} asking={!!which} />
        {(snap.view.me === null || snap.watching) && !ended(snap) && (
          <p className="aside">{spectator ? 'You’re watching.' : 'You’ll play the next game.'}</p>
        )}
        {!which && <Tip snap={snap} tip={layout.tip} />}
      </div>
      <Spoken snap={snap} asking={!!which} />
      <Sheets
        which={which}
        game={game}
        snap={snap}
        face={face}
        setLook={setLook}
        onLeave={onLeave}
        onAgain={onAgain}
        onJoin={onJoin}
        link={link}
        watchable={watchable}
      />
    </main>
  )
}

function Lights({ kind }: { kind: keyof typeof Flush }) {
  const { depth, duration } = Flush[kind]
  return (
    <motion.div
      className="flush"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, depth, 0], transition: { duration, times: [0, Slam.peak / duration, 1] } }}
      exit={{ opacity: 0, transition: tween(Time.micro) }}
    />
  )
}
