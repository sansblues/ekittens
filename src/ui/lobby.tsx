import { canPlay } from '../lobby'
import { Invite } from './invite'
import { LeaveIcon, Option, PlayIcon, useLate, useTell } from './kit'
import { SeatsRow } from './seats-row'
import { Screen } from './start'

// A room's lobby: home's screen with everyone in one row of seats, in the order they were taken; then the room's
// link, and Leave, as its sign, beside Play. On Play, each face glides to its seat in the game.

interface Props {
  /** Everyone at the table, in the order they came: you among them, once the room has spoken (before, nobody). */
  people: { name: string; face: number; you: boolean }[]
  bots: number[]
  /** None until the room has spoken. */
  onBots?: (faces: number[]) => void
  onPlay: () => void
  link: string
  /** While the line to the room is down, what it's doing: "Connecting…", or once it has been up,
   *  "Reconnecting…". */
  wait?: string
  onLeave: () => void
}

export function Lobby({ people, bots, onBots, onPlay, link, wait, onLeave }: Props) {
  // Said only once the line stays down, so a room opening never flickers it.
  const said = useLate(wait)
  const why = people.length > 0 && !canPlay({ people, bots }) ? 'Invite a friend, or add a bot.' : null
  return (
    <Screen face={people.find((p) => p.you)?.face ?? 0}>
      <SeatsRow people={people} bots={bots} onBots={onBots} />
      <div className="actions">
        <Invite link={link} />
        {/* As the game's sheets pair them: the way out, and the main move on the right. */}
        <div className="row">
          <Option square aria-label="Leave the room" onClick={onLeave}>
            <LeaveIcon />
          </Option>
          <Play why={why} wait={said} onPlay={onPlay} />
        </div>
      </div>
    </Screen>
  )
}

/** Dimmed while it can't start a game, and then, like a dimmed card, it says `why`: once a mouse rests on it,
 *  or on a press. Only dimmed, not disabled, so a press still reaches it. While the line is down, it says so
 *  itself, as Join says the table's full. */
function Play({ why, wait, onPlay }: { why: string | null; wait?: string; onPlay: () => void }) {
  const { shown, tell, bind } = useTell()
  const told = !wait && why !== null && shown
  return (
    <div className="play">
      <Option
        primary
        aria-disabled={!!wait || why !== null || undefined}
        aria-describedby={told ? 'why-not' : undefined}
        onClick={() => !wait && (why === null ? onPlay() : tell())}
        onPointerEnter={bind.onPointerEnter}
        onPointerLeave={bind.onPointerLeave}
      >
        <PlayIcon />
        {wait ?? 'Play'}
      </Option>
      <p className="unseen" role="status">
        {wait}
      </p>
      {told && (
        <div className="tip why" role="tooltip" id="why-not">
          <p className="cardtip">{why}</p>
        </div>
      )}
    </div>
  )
}
