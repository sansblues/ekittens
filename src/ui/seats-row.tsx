import { motion } from 'motion/react'
import { Characters, facesAfter, seats } from '../lobby'
import { Seated } from './avatar'
import { Spring, Time, tween } from './design'
import { BotIcon, CloseIcon, Fit, PlusIcon, Tag } from './kit'

const Pop = { initial: { opacity: 0, scale: 0.9 }, animate: { opacity: 1, scale: 1 } }

/** A seat that moves (the bots, as a person sits down before them) glides there. */
const Glide = { layout: 'position', transition: Spring.quick } as const

/** The table's five seats, the people first, then the bots, each name under its face (yours lit), bots with a
 *  bot's badge; then empty seats. With `onBots` (a room's lobby), a tap on a bot sends it away (a mouse shows its ×
 *  first) and the next empty seat's + seats a bot there; without (a friend's link, before joining), they only show. */
export function SeatsRow({
  people,
  bots,
  onBots,
}: {
  /** `you`: this screen's own seat. */
  people: { name: string; face: number; you?: boolean }[]
  bots: number[]
  onBots?: (faces: number[]) => void
}) {
  const order = seats({ people, bots })
  const you = people.find((p) => p.you)?.face ?? -1
  // The face after yours that nobody wears yet.
  const next = facesAfter(you).find((f) => !order.includes(f))
  const empty = Characters.length - order.length
  return (
    <ul className="seats-row" aria-label="Who’s playing">
      {order.map((face) => {
        const person = people.find((p) => p.face === face)
        if (person)
          return (
            <motion.li
              key={`seat-${face}`}
              className={person.you ? 'mine' : undefined}
              aria-label={person.you ? `You, ${person.name}` : person.name}
              {...Pop}
              {...Glide}
            >
              <Seated face={face} size="var(--seat)" />
              <Name>{person.name}</Name>
            </motion.li>
          )
        if (!onBots)
          return (
            <motion.li key={`seat-${face}`} aria-label={`The bot ${Characters[face]!.name}`} {...Glide}>
              <span className="bot">
                <Seated face={face} size="var(--seat)" />
                <Tag>
                  <BotIcon />
                </Tag>
              </span>
              <Name>{Characters[face]!.name}</Name>
            </motion.li>
          )
        return (
          <motion.li key={`seat-${face}`} {...Glide}>
            <motion.button
              className="bot"
              aria-label={`Remove the bot ${Characters[face]!.name}`}
              onClick={() => onBots(bots.filter((b) => b !== face))}
              {...Pop}
              transition={Spring.quick}
            >
              <Seated face={face} size="var(--seat)" />
              <Tag>
                <BotIcon />
              </Tag>
              <Tag at="top" reveal>
                <CloseIcon />
              </Tag>
            </motion.button>
            <Name>{Characters[face]!.name}</Name>
          </motion.li>
        )
      })}
      {Array.from({ length: empty }, (_, i) => (
        // The + keeps its key as it moves on a seat, so a keyboard keeps its focus to add the next bot.
        <motion.li key={onBots && i === 0 ? 'add' : `empty-${order.length + i}`} {...Glide}>
          {/* Only the next seat takes a bot: one +, where the bot will sit. */}
          {!onBots || i > 0 ? (
            <span className="empty well" role="img" aria-label="Empty seat" />
          ) : (
            <>
              <motion.button
                className="empty well"
                aria-label="Add a bot"
                onClick={() => next !== undefined && onBots([...bots, next])}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={tween(Time.fade)}
              >
                <PlusIcon />
              </motion.button>
              <span className="name add" aria-hidden>
                Add a bot
              </span>
            </>
          )}
        </motion.li>
      ))}
    </ul>
  )
}

const Name = ({ children }: { children: string }) => (
  <Fit className="name" aria-hidden>
    {children}
  </Fit>
)
