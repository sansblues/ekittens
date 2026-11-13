import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Characters, NameLength, characters, clip, faceAt, facesAfter, freeFaces, type Table } from '../lobby'
import { Seated } from './avatar'
import { after } from './browser'
import { Time } from './design'
import { Guide } from './guide'
import { Logo } from './logo'
import { FriendsIcon, JoinIcon, LeaveIcon, Option, PlayIcon, Tag, TurnIcon } from './kit'
import { SeatsRow } from './seats-row'

// The first screen: the game's name, who you are, the ways in, and how to play. A friend's link shows it too,
// with one way in: Join. A room's lobby is the same screen, everyone in its seats.

interface Props {
  face: number
  onFace: (face: number) => void
  /** The one you gave; empty, you go by `nick`. */
  name: string
  nick: string
  onName: (name: string) => void
  ways: Solo | Join
}

/** A friend's link: who's at the table (null until the room has said), and the way in or back. */
interface Join {
  table: Table | null
  onJoin: () => void
  onLeave: () => void
}

/** Home: the two ways in. */
interface Solo {
  onPlay: () => void
  onFriends: () => void
}

export function Start({ face: yours, onFace, name, nick, onName, ways }: Props) {
  // A name still being typed is kept first: a phone keeps the field focused through a tap on a button.
  const typed = (fn: () => void) => () => {
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    fn()
  }
  const table = 'onJoin' in ways ? ways.table : null
  // Every seat a person's, you wait for one to free (the row shows it live); any game on, you watch meanwhile.
  const full = table?.people.length === Characters.length
  // On a friend's link, the face you'd sit at, and only those nobody at the table wears to turn to.
  const face = (table && faceAt(table, yours)) ?? yours
  const free = freeFaces(table ?? { people: [], bots: [] })
  const turn = free.length > 1 ? () => onFace(facesAfter(face).find((f) => free.includes(f))!) : undefined
  return (
    <Screen face={face}>
      {'onJoin' in ways ? (
        <>
          <SeatsRow people={ways.table?.people ?? []} bots={ways.table?.bots ?? []} />
          {/* You, and the way in: as the lobby pairs Leave and Play. */}
          <div className="actions joining">
            <You face={face} name={name} nick={nick} onFace={turn} onName={onName} />
            <div className="row">
              <Option square aria-label="Back home" onClick={ways.onLeave}>
                <LeaveIcon />
              </Option>
              <Option primary aria-disabled={full || undefined} onClick={full ? undefined : typed(ways.onJoin)}>
                <JoinIcon />
                {full ? 'The table’s full' : 'Join the game'}
              </Option>
            </div>
          </div>
        </>
      ) : (
        <>
          <You face={face} name={name} nick={nick} onFace={turn} onName={onName} />
          <div className="actions">
            <Option primary onClick={typed(ways.onPlay)}>
              <PlayIcon />
              Play against bots
            </Option>
            <Option onClick={typed(ways.onFriends)}>
              <FriendsIcon />
              Play with friends
            </Option>
          </div>
        </>
      )}
    </Screen>
  )
}

let entered = false

/** Home, a friend's link and a room's lobby alike: one block, the game's name over what this screen asks; beside
 *  it how to play (under it on a narrower screen). */
export function Screen({ face, children }: { face: number; children: ReactNode }) {
  // It settles in the first time it shows, once its pictures are in (or, on a slow line, soon anyway); going
  // from home to a room after, it's already here.
  const [enter, setEnter] = useState<'wait' | 'go' | null>(() => (entered ? null : 'wait'))
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    entered = true
    if (enter !== 'wait') return
    let gone = false
    // Whichever comes first, pictures in or time up, starts it; the other then does nothing.
    const go = () => !gone && setEnter((e) => (e === 'wait' ? 'go' : e))
    void Promise.all([...main.current!.querySelectorAll('img')].map((img) => img.decode().catch(() => {}))).then(go)
    const late = after(Time.ready, go)
    return () => {
      gone = true
      late()
    }
  }, [])
  // Settled, it lets go: what shows later (a card's tip) arrives its own way, not as the page did.
  useEffect(() => (enter === 'go' ? after(Time.enter + 2 * Time.step, () => setEnter(null)) : undefined), [enter])
  return (
    <main ref={main} className="home" data-enter={enter ?? undefined}>
      <div className="panel">
        <div className="lead">
          <Logo />
          <div className="setup">{children}</div>
        </div>
        <section className="how" aria-label="How to play">
          <Guide face={face} />
        </section>
      </div>
    </main>
  )
}

/** Your face and name side by side, both yours to change: before a room, which then keeps them. */
function You({
  face,
  name,
  nick,
  onFace,
  onName,
}: {
  face: number
  name: string
  nick: string
  /** None: there's no other face to turn to. */
  onFace?: () => void
  onName: (name: string) => void
}) {
  // It stays put: the lobby's row wears the same face once you're in (or already does, on a friend's link),
  // and one drawn here for a frame, then there, only jitters.
  const seated = <Seated face={face} size="var(--face)" still />
  return (
    <section className="you" aria-label="You">
      {/* The whole face changes it; the sign on its corner says so. */}
      {onFace ? (
        <button className="me" aria-label="Change your character" onClick={onFace}>
          {seated}
          <Tag>
            <TurnIcon />
          </Tag>
        </button>
      ) : (
        <div className="me">{seated}</div>
      )}
      <NameField name={name} nick={nick} onName={onName} />
    </section>
  )
}

/** Plainly a field, always the same size. What you type is kept as you leave it or press Enter; empty, you
 *  go by your nickname, shown in it. */
function NameField({ name, nick, onName }: { name: string; nick: string; onName: (name: string) => void }) {
  const [draft, setDraft] = useState(name)
  return (
    <input
      className="field well"
      value={draft}
      placeholder={nick}
      enterKeyHint="done"
      autoComplete="nickname"
      spellCheck={false}
      aria-label="Your name"
      // Full, it takes no more, as a field with a limit does; a paste too long is cut.
      maxLength={characters(draft).length >= NameLength ? draft.length : undefined}
      onChange={(e) => setDraft(clip(e.target.value))}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim()
        setDraft(next)
        if (next !== name) onName(next)
      }}
      onKeyDown={(e) => {
        // Mid-word in an input method, these keys are its own.
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          // Put back before the blur, which keeps what the field holds.
          e.currentTarget.value = name
          setDraft(name)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
