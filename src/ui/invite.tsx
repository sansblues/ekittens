import { useEffect, useRef, useState } from 'react'
import { after, input, share } from './browser'
import { Time } from './design'
import { Fit, LinkIcon, Swap } from './kit'

/** A room's link, shown, and a button that shares it by a phone's share sheet, or copies it, which it then
 *  confirms in place. */
export function Invite({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => (copied ? after(Time.told, () => setCopied(false)) : undefined), [copied])
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [failed])
  if (failed)
    return (
      // The same box, so nothing moves: the link in it, selected to copy by hand, and where the button was, that.
      <div className="invite well" data-failed>
        <input ref={field} className="url" aria-label="Room link" readOnly value={link} />
        <span className="act" aria-hidden>
          Copy it
        </span>
        <p className="unseen" role="status">
          Couldn’t share the link. Copy it from the field.
        </p>
      </div>
    )
  const sheet = input() === 'touch' && !!navigator.share
  const url = new URL(link)
  return (
    <button
      className="invite well"
      data-copied={copied || undefined}
      aria-label={sheet ? 'Share the link to invite friends' : 'Copy the link to invite friends'}
      onClick={() =>
        void share(link).then((how) => {
          if (how === 'copied') setCopied(true)
          if (how === 'failed') setFailed(true)
        })
      }
    >
      <span className="url">
        {/* A cut address fades out at the code, where an ellipsis would leave a cut letter's gap before it. */}
        <Fit className="host">{url.host}</Fit>
        <span>{url.pathname}</span>
      </span>
      <span className="act" aria-live="polite">
        <Swap id={copied ? 'copied' : 'idle'}>
          {/* Copied, the field turns green and the word says so; the sign stays, so nothing jumps. */}
          <LinkIcon />
          {copied ? 'Copied' : 'Invite'}
        </Swap>
      </span>
    </button>
  )
}
