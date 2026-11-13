// Storage, input, timers and the clock, wrapped once for the whole app.

/** In seconds. */
export const now = () => performance.now() / 1000

/** Runs `fn` in `s` seconds; returns what cancels it (an effect's cleanup). */
export function after(s: number, fn: () => void) {
  const t = setTimeout(fn, s * 1000)
  return () => clearTimeout(t)
}

type Events = WindowEventMap & DocumentEventMap

/** Listens until the returned cleanup runs. `capture`: before the page's own handlers. */
export function listen<K extends keyof Events>(target: EventTarget, type: K, fn: (e: Events[K]) => void, capture = false) {
  target.addEventListener(type, fn as EventListener, capture)
  return () => target.removeEventListener(type, fn as EventListener, capture)
}

/** `key` takes your seat back. `playing` is where the plain address leads while your game is on. */
type Key = 'game' | 'character' | 'mute' | 'name' | 'nick' | 'key' | 'playing' | `room.${string}`

/** What was saved under `key`, unchecked: undefined if nothing was, or it can't be read. */
export function load(key: Key): unknown {
  try {
    const text = kept.get(key) ?? localStorage.getItem(`ek.${key}`)
    return text === null ? undefined : JSON.parse(text)
  } catch (error) {
    if (isBlocked(error) || error instanceof SyntaxError) return undefined
    throw error
  }
}

export function save(key: Key, value: unknown) {
  const text = JSON.stringify(value)
  try {
    localStorage.setItem(`ek.${key}`, text)
    kept.delete(key)
  } catch (error) {
    if (!isBlocked(error)) throw error
    kept.set(key, text)
  }
}

export function forget(key: Key) {
  kept.delete(key)
  try {
    localStorage.removeItem(`ek.${key}`)
  } catch (error) {
    if (!isBlocked(error)) throw error
  }
}

/** One key per room, so a tab in another room can't overwrite your seat or its last deal. */
const roomKey = (code: string): Key => `room.${code}`
const isDeal = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 2 ** 32

export function joinedRoom(code: string): boolean {
  const remembered = load(roomKey(code))
  return remembered === true || isDeal(remembered) || load('playing') === code
}

export function rememberedDeal(code: string): number | undefined {
  const remembered = load(roomKey(code))
  if (isDeal(remembered)) return remembered
}

export function rememberRoom(code: string, deal?: number) {
  if (deal !== undefined || rememberedDeal(code) === undefined) save(roomKey(code), deal ?? true)
}

export function acknowledgeDeal(code: string, deal: number) {
  if (rememberedDeal(code) === deal) save(roomKey(code), true)
}

export function forgetPlaying(code: string) {
  if (load('playing') === code) forget('playing')
}

export function forgetRoom(code: string) {
  forget(roomKey(code))
  forgetPlaying(code)
}

/** Whether `what` already happened in this tab in the last minute; if not, it's noted as happening now. So
 *  what could loop (a reload, the screen breaking) never does. Unsure, it counts as recent. */
export function recently(what: 'reloaded' | 'broke'): boolean {
  // In seconds, by the wall clock: unlike `now`'s, it runs on through a reload.
  const at = Date.now() / 1000
  try {
    if (at - Number(sessionStorage.getItem(`ek.${what}`)) < 60) return true
    sessionStorage.setItem(`ek.${what}`, String(at))
    return false
  } catch {
    return true
  }
}

/** Reloads the page, unless it already did in the last minute: an update that won't take never loops. Returns
 *  whether it reloads. */
export function reload(): boolean {
  if (recently('reloaded')) return false
  location.reload()
  return true
}

// Storage that is blocked (a private window) or full throws a DOMException: then this tab keeps what it can't,
// until it closes, so what it picked once (your face, key) stays picked, and the game plays on.
const isBlocked = (error: unknown) => error instanceof DOMException
const kept = new Map<Key, string>()

const reduced = matchMedia('(prefers-reduced-motion: reduce)')

/** Reduced motion: nothing travels. */
export const still = () => reduced.matches

export type Input = 'key' | 'mouse' | 'touch'

let last: Input = matchMedia('(hover: none)').matches ? 'touch' : 'mouse'
listen(window, 'keydown', () => (last = 'key'), true)
listen(window, 'pointerdown', (e) => (last = e.pointerType === 'mouse' ? 'mouse' : 'touch'), true)
// A mouse that moves is back in hand, after a key: tips speak to it again.
listen(window, 'pointermove', (e) => e.pointerType === 'mouse' && (e.movementX || e.movementY) && (last = 'mouse'), true)

/** How you last reached for the game. */
export const input = () => last

/** Shares a link: a phone's share sheet on touch, the clipboard otherwise. Call it straight from a tap: a
 *  phone shares only then. 'copied' is worth saying; a share sheet speaks for itself. */
export async function share(url: string): Promise<'shared' | 'copied' | 'dismissed' | 'failed'> {
  const native = last === 'touch' && !!navigator.share
  try {
    if (native) {
      await navigator.share({ url })
      return 'shared'
    }
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch (error) {
    return native && error instanceof DOMException && error.name === 'AbortError' ? 'dismissed' : 'failed'
  }
}
