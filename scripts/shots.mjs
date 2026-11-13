// Plays solo game scenes and captures home, a friend's link and a room's lobby at four sizes, using a fake clock and
// seeded randomness.
// Checks each capture at rest: no errors, nothing off-screen, scrolling sideways or cut off in a sheet,
// and text contrast, on the table against its real pixels and on the interface against its fill.
// Usage: npm run shots [out], by default shots/now (URL=… to use a running dev server); compare two
// runs with npm run shots:diff.
import { writeFileSync } from 'node:fs'
import { chrome, clean, count } from './chrome.mjs'

const Out = process.argv[2] ?? 'shots/now'
// A computer, a phone, and each other size that lays the table out its own way: a tablet upright (its
// cards grow apart from the text) and a phone on its side (short). [width, height, touch]
const Sizes = [
  [1440, 900, false],
  [390, 844, true],
  [768, 1024, true],
  [844, 390, true],
]
// Scenes playing at once: each has its own page, so more only contend for the machine.
const Parallel = 8
// Table text whose contrast is read against the real pixels behind it.
const TableText =
  '.seat .name, .seat .n, .onward, .arrow, .byline .who:not([data-hit]) > :not(.avatar), .corner .icon-button, .home h1, .you .field, .seats-row .name, .guide .rules button'
let server
let url = process.env.URL
if (!url) {
  const { createServer } = await import('vite')
  server = await createServer({ server: { port: 0 }, logLevel: 'silent' })
  await server.listen()
  url = server.resolvedUrls.local[0]
}
// Once Chrome is up: a machine without it keeps its last run.
const browser = await chrome()
clean(Out)
const issues = [] // [screen, problem]
let screens = 0

// Plays one scene on a page of its own: a scene's failure stops only that scene, and its seeded
// randomness is its own, so a change to one scene never changes how another plays.
const play = async ([w, h, touch], scene) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 })
  let screen = scene.name
  try {
    const page = await ctx.newPage()
    page.on('pageerror', (e) => issues.push([`${w}-${screen}`, e.message]))
    page.on('console', (m) => m.type() === 'error' && issues.push([`${w}-${screen}`, `console: ${m.text()}`]))
    // The game's time moves only when a scene ticks it. Installed, a fake clock still flows with real time:
    // paused, a slow machine plays exactly like a fast one.
    await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') })
    await page.clock.pauseAt(new Date('2026-01-01T12:00:01Z'))
    // On every load, before the app's first line: seeded, so each screen plays the same way every run;
    // muted, since a sound's random pick depends on when its file loaded; no CSS motion and no Web
    // Animations, which run on real time (Motion then runs every animation in JS, on the fake clock); and
    // the helpers the moves and checks below use.
    await page.addInitScript(() => {
      localStorage.setItem('ek.mute', 'true')
      delete Element.prototype.animate
      let s = 7
      Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647
      addEventListener('DOMContentLoaded', () => {
        const still = document.createElement('style')
        still.textContent = '*,*::before,*::after{caret-color:transparent;transition:none!important;animation:none!important}'
        document.head.append(still)
      })
      // A player's card of a kind, and the ids of all of them.
      window.card = (player, kind) => window.room.state.players[player].hand.find((c) => c.kind === kind)
      window.cards = (player, kind) => window.room.state.players[player].hand.filter((c) => c.kind === kind).map((c) => c.id)
      // The deck's top card as the table shows it, face down (its id counts up from the deck's bottom: table.ts).
      window.onDeck = () => ({ id: -window.game.snap.view.deck, kind: null })
      // A CSS color's RGBA, its luminance, and two luminances' contrast (WCAG).
      window.rgba = (css) => {
        const k = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
        k.fillStyle = css
        k.fillRect(0, 0, 1, 1)
        return [...k.getImageData(0, 0, 1, 1).data]
      }
      window.luminance = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      window.contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    })
    // Every font loaded and every image decoded. Real time passes while the game's clock stands still: text
    // laid out late would set what's around it moving again, and an emblem caught half-decoded would differ.
    const ready = () =>
      page.evaluate(() =>
        Promise.all([...[...document.fonts].map((f) => f.load()), ...[...document.images].map((i) => i.decode().catch(() => {}))]),
      )
    await page.goto(url, { waitUntil: 'networkidle' })
    await ready()
    // The viewport as a base64 PNG: lossless all the same, encoded in a third of the time.
    const cdp = await ctx.newCDPSession(page)
    const capture = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data
    const tick = (s) => page.clock.runFor(s * 1000)
    // At rest: step the clock until nothing on the page has moved a hundredth of a pixel, faded, blurred or changed its
    // words for three steps in a row (a spring snaps to its end only once slow: a coarser look calls it done a frame
    // early). False if it never is, within 6 s.
    const settle = async () => {
      let last = ''
      let still = 0
      for (let i = 0; i < 120; i++) {
        await tick(0.05)
        const now = await page.evaluate(
          () =>
            document.body.textContent +
            [...document.querySelectorAll('body *')]
              .map((e) => {
                const r = e.getBoundingClientRect()
                const { opacity, filter } = getComputedStyle(e)
                return `${r.x.toFixed(2)},${r.y.toFixed(2)},${r.width.toFixed(2)},${r.height.toFixed(2)},${opacity},${filter}`
              })
              .join('|'),
        )
        still = now === last ? still + 1 : 0
        if (still === 3) return true
        last = now
      }
      return false
    }
    const check = async () => {
      const where = `${w}-${screen}`
      // Nothing off-screen, nothing scrolling sideways.
      const off = await page.evaluate(() => {
        const vw = innerWidth
        const vh = innerHeight
        const out = []
        const label = (e) => e.getAttribute('aria-label') || e.className.baseVal || e.className
        for (const e of document.querySelectorAll('.pill, .sheet, .byline, .seat, .tip, .corner, .slotted, .field')) {
          if (+getComputedStyle(e).opacity < 0.05) continue
          const r = e.getBoundingClientRect()
          if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)
            out.push(`${label(e)} off-screen (${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)})`)
        }
        for (const e of document.querySelectorAll('.sheet, .sheet *'))
          if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') out.push(`${label(e)} scrolls sideways`)
        if (document.documentElement.scrollWidth > vw + 1) out.push('the page scrolls sideways')
        // A sheet holds what it asks whole: one that scrolls hides its buttons below the fold.
        const sheet = document.querySelector('.sheet')
        if (sheet && sheet.scrollHeight > sheet.clientHeight + 1)
          out.push(`the sheet scrolls: ${sheet.scrollHeight - sheet.clientHeight} px don't fit`)
        return out
      })
      off.forEach((o) => issues.push([where, o]))
      // Contrast of text on the interface (sheets, the pill, tips, chips): 4.5:1 against the solid fill right behind it.
      const paper = await page.evaluate(() => {
        const fill = (e) => {
          for (; e; e = e.parentElement) {
            const c = rgba(getComputedStyle(e).backgroundColor)
            if (c[3] === 255) return c
          }
        }
        const out = []
        for (const e of document.querySelectorAll('.sheet *, .pill *, .cardtip *, .badge')) {
          const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
          if (!own || e.closest('.card') || +getComputedStyle(e).opacity < 0.5) continue
          const ratio = contrast(luminance(rgba(getComputedStyle(e).color)), luminance(fill(e)))
          if (ratio < 4.5) out.push(`"${e.textContent.trim()}" contrast ${ratio.toFixed(2)}:1 on its surface (needs 4.5:1)`)
        }
        return out
      })
      paper.forEach((o) => issues.push([where, o]))
      // Contrast of text on the table, against the real pixels behind it (not under a dim).
      if (await page.evaluate(() => !!document.querySelector('.sheet, .spotlight, .scrim'))) return
      const items = await page.evaluate(
        (sel) =>
          [...document.querySelectorAll(sel)]
            .filter((e) => +getComputedStyle(e).opacity > 0.5 && !e.closest('[data-hidden], [data-out]'))
            .map((e) => {
              const r = e.getBoundingClientRect()
              const cs = getComputedStyle(e)
              const size = parseFloat(cs.fontSize)
              const bold = +cs.fontWeight >= 700
              return {
                label: e.textContent || e.getAttribute('aria-label'),
                x: r.x,
                y: r.y,
                w: r.width,
                h: r.height,
                color: cs.color,
                large: e.matches('.corner .icon-button, .onward, .arrow') || size >= 24 || (bold && size >= 18.66),
              }
            }),
        TableText,
      )
      if (!items.length) return
      const hide = await page.addStyleTag({ content: `${TableText} { visibility: hidden !important }` })
      const bg = await capture()
      await hide.evaluate((e) => e.remove())
      const bad = await page.evaluate(
        async ([bg, items]) => {
          const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + bg)).blob())
          const x = new OffscreenCanvas(img.width, img.height).getContext('2d', { willReadFrequently: true })
          x.drawImage(img, 0, 0)
          const out = []
          for (const t of items) {
            const d = x.getImageData(
              Math.max(0, Math.round(t.x)),
              Math.max(0, Math.round(t.y)),
              Math.max(1, Math.round(t.w)),
              Math.max(1, Math.round(t.h)),
            ).data
            let sum = 0
            for (let i = 0; i < d.length; i += 4) sum += luminance([d[i], d[i + 1], d[i + 2]])
            const ratio = contrast(luminance(rgba(t.color)), sum / (d.length / 4))
            const need = t.large ? 3 : 4.5
            if (ratio < need) out.push(`"${t.label}" contrast ${ratio.toFixed(2)}:1 (needs ${need}:1)`)
          }
          return out
        },
        [bg, items],
      )
      bad.forEach((o) => issues.push([where, o]))
    }
    const shot = async (name) => {
      screen = name
      if (!(await settle())) issues.push([`${w}-${name}`, 'never came to rest'])
      await ready()
      await tick(0.016)
      writeFileSync(`${Out}/${w}-${name}.png`, Buffer.from(await capture(), 'base64'))
      screens++
      await check()
    }
    // A game, loaded as if saved: the hands, the deck's top and the pile as given, the rest of the deck
    // from what's left, with a kitten for every player but one.
    const craft = async (spec) => {
      await page.evaluate(async (spec) => {
        const { Counts, setup } = await import('/src/engine.ts')
        const { Version } = await import('/src/room.ts')
        const { Characters } = await import('/src/lobby.ts')
        const s = setup(spec.players, 7)
        const all = Object.entries(Counts)
          .flatMap(([kind, n]) => Array(n).fill(kind))
          .map((kind, id) => ({ id, kind }))
        const take = (kind) => {
          const i = all.findIndex((c) => c.kind === kind)
          if (i === -1) throw new Error(`no ${kind} left to craft with`)
          return all.splice(i, 1)[0]
        }
        s.players.forEach((p, i) => (p.hand = (spec.hands[i] ?? []).map(take)))
        const top = (spec.deckTop ?? []).map(take)
        // Before the rest of the deck is cut from what's left, so no card is dealt twice.
        s.discard = (spec.discard ?? []).map(take)
        const rest = all.filter((c) => c.kind !== 'exploding-kitten').slice(0, 12)
        for (let i = 0; i < spec.players - 1 - top.filter((c) => c.kind === 'exploding-kitten').length; i++)
          rest.splice(4 + i * 3, 0, take('exploding-kitten'))
        s.deck = [...top, ...rest]
        s.current = spec.current ?? 0
        const cast = s.players.map((_, face) => ({ face, name: Characters[face].name, bot: face > 0 }))
        // The shape of room.ts's Saved. One silent move in the past: a game under way is not dealt again.
        const saved = { v: Version, deal: 1, state: s, cast, memory: cast.map(() => []), events: [{ t: 'shuffled' }] }
        localStorage.setItem('ek.game', JSON.stringify(saved))
      }, spec)
      await page.reload()
      await page.waitForFunction(() => window.game)
      await ready()
    }
    // A move made through the game itself; one it ignores (wrong moment, wrong card) fails the scene.
    const act = (f) =>
      page.evaluate(
        `(() => { const before = game.snap; (${f})(); if (game.snap === before) throw new Error(${JSON.stringify(`ignored: ${f}`)}) })()`,
      )
    // A click on a table at rest (what's leaving has left), then the pointer out of the way, so nothing
    // reads as hovered after.
    const click = async (target) => {
      await settle()
      await target.click()
      await page.mouse.move(2, 2)
      await tick(1)
    }

    await scene({ page, touch, tick, shot, craft, act, click })
  } catch (e) {
    issues.push([`${w}-${screen}`, e.message])
  } finally {
    await ctx.close()
  }
}

// Every scene but the first starts from a crafted game. Bots' moves are forced through the room.
const Scenes = [
  async function start({ page, tick, shot }) {
    await tick(0.5)
    await shot('01-start')
    // One real start, so the deal runs and any error in it is caught; the other scenes are crafted.
    await page.getByRole('button', { name: 'Play against bots', exact: true }).click()
    await tick(3)
  },
  async function turn({ page, touch, tick, shot, craft, act }) {
    await craft({
      players: 4,
      hands: [
        ['defuse', 'nope', 'skip', 'favor', 'tacocat', 'tacocat', 'see-the-future', 'attack'],
        ['skip', 'defuse', 'nope'],
        ['favor', 'attack', 'shuffle'],
        ['shuffle', 'cattermelon'],
      ],
      deckTop: ['exploding-kitten', 'skip', 'nope'],
      discard: ['shuffle', 'skip'],
    })
    await shot('02-turn')
    // A card's tip, on your turn: the pointer rests on one, then leaves. Two moves: hover follows real movement.
    if (!touch) {
      const r = await page.locator('.slotted[aria-label^="Defuse"]').boundingBox()
      await page.mouse.move(r.x + r.width / 2, r.y + 40)
      await page.mouse.move(r.x + r.width / 2 + 2, r.y + 42)
      await tick(0.8)
      await shot('03-tip')
      await page.mouse.move(2, 2)
      await tick(0.5)
    }
    await act(() => game.make(onDeck()))
    await tick(6)
    await shot('04-kitten')
    await act(() => game.make(card(0, 'defuse')))
    await tick(3)
    await shot('05-place')
  },
  async function favor({ tick, shot, craft, act }) {
    await craft({
      players: 3,
      current: 1,
      hands: [['skip', 'nope', 'tacocat', 'defuse'], ['favor', 'shuffle'], ['shuffle']],
      deckTop: ['cattermelon', 'see-the-future'],
      discard: ['attack'],
    })
    await act(() => room.move({ t: 'play', player: 1, cards: cards(1, 'favor'), target: 0 }))
    await tick(1.2)
    await shot('06-window-at-you')
    await tick(6)
    await shot('07-give')
    await act(() => game.give(card(0, 'skip')))
    await tick(0.7)
    await shot('08-pass')
  },
  // Every sheet you open yourself: a triple's questions, a peek, the log (from the pile), and the menu,
  // whose Leave asks once more as the sheet's next step.
  async function sheets({ page, tick, shot, craft, act, click }) {
    await craft({
      players: 3,
      hands: [
        ['tacocat', 'tacocat', 'tacocat', 'favor', 'see-the-future', 'skip'],
        ['shuffle', 'attack'],
        ['beard-cat', 'defuse'],
      ],
      deckTop: ['cattermelon', 'skip', 'nope'],
      discard: ['attack'],
    })
    await act(() => game.make(card(0, 'tacocat')))
    await tick(1)
    await shot('09-size')
    await act(() => game.chooseSize(3))
    await tick(1)
    await shot('10-target')
    await act(() => game.chooseTarget(1))
    await tick(1)
    await shot('11-name')
    await act(() => game.cancelDraft())
    await tick(1)
    await act(() => game.make(card(0, 'see-the-future')))
    await tick(8)
    await shot('12-peek')
    await act(() => game.dismissFuture())
    await tick(1)
    await click(page.locator('.slotted[aria-label^="Discard pile"]'))
    await shot('13-log')
    await click(page.getByRole('button', { name: 'Back to the game' }))
    await click(page.getByRole('button', { name: 'Menu' }))
    await shot('14-menu')
    await click(page.getByRole('button', { name: 'How to play' }))
    await shot('14-rules')
    await click(page.getByRole('button', { name: 'Back to the game' }))
    await click(page.getByRole('button', { name: 'Menu' }))
    await click(page.getByRole('button', { name: 'Leave the game' }))
    await shot('14-leave')
  },
  // A bot's triple, at another bot.
  async function triple({ tick, shot, craft, act }) {
    await craft({
      players: 3,
      current: 2,
      hands: [['skip', 'nope'], ['skip'], ['tacocat', 'tacocat', 'tacocat', 'favor']],
      deckTop: ['cattermelon'],
      discard: ['favor'],
    })
    await act(() => room.move({ t: 'play', player: 2, cards: cards(2, 'tacocat'), target: 1, named: 'skip' }))
    await tick(1.2)
    await shot('15-triple')
  },
  async function lose({ tick, shot, craft, act }) {
    await craft({ players: 2, hands: [['skip'], ['shuffle']], deckTop: ['exploding-kitten', 'skip'] })
    await act(() => game.make(onDeck()))
    await tick(9)
    await shot('16-lose')
  },
  async function win({ tick, shot, craft }) {
    await craft({ players: 2, current: 1, hands: [['skip'], ['shuffle']], deckTop: ['exploding-kitten', 'skip'] })
    await tick(15)
    await shot('17-win')
  },
  async function crowded({ shot, craft }) {
    await craft({
      players: 5,
      hands: [
        // Every kind a hand can hold, so every card's face is seen and checked.
        [
          'defuse',
          'nope',
          'skip',
          'favor',
          'tacocat',
          'cattermelon',
          'see-the-future',
          'attack',
          'shuffle',
          'beard-cat',
          'hairy-potato-cat',
          'rainbow-ralphing-cat',
        ],
        ['skip'],
        ['favor'],
        ['shuffle'],
        ['attack'],
      ],
      deckTop: ['cattermelon', 'skip', 'nope'],
      discard: ['shuffle'],
    })
    await shot('18-crowded')
  },
  // Taking a card from a big hand, face down: a straight spread, in rows when it must be.
  async function steal({ tick, shot, craft, act }) {
    await craft({
      players: 2,
      hands: [
        ['tacocat', 'tacocat', 'skip'],
        ['skip', 'favor', 'shuffle', 'attack', 'see-the-future', 'cattermelon', 'beard-cat', 'skip', 'favor'],
      ],
      deckTop: ['skip'],
    })
    await act(() => room.move({ t: 'play', player: 0, cards: cards(0, 'tacocat'), target: 1 }))
    await tick(6)
    await shot('19-steal')
  },
  // A friend's link to a table of two (one with a name as long as a name gets) and a bot, with you under it, then
  // its lobby once you've joined, seated as a room seats you: the room's line is answered here, so it's the same
  // every run.
  async function link({ page, shot, click }) {
    const names = ['Ansat', 'Maximilianus']
    const lobby = (you) => ({
      t: 'lobby',
      people: [...names.map((name, face) => ({ name, face, you: false })), ...(you ? [{ ...you, you: true }] : [])],
      bots: [4],
      playing: false,
    })
    await page.routeWebSocket(/\/api\/rooms\//, (ws) =>
      ws.onMessage((m) => {
        if (m === 'ping') return ws.send('pong')
        const { t, name, face } = JSON.parse(m)
        if (t === 'look') ws.send(JSON.stringify(lobby()))
        if (t === 'hello') ws.send(JSON.stringify(lobby({ name, face: [2, 3].includes(face) ? face : 2 })))
      }),
    )
    await page.goto(new URL('/CATS', url).href)
    await shot('20-link')
    await click(page.getByRole('button', { name: 'Join the game' }))
    await shot('21-lobby')
  },
]

try {
  const queue = Sizes.flatMap((size) => Scenes.map((scene) => () => play(size, scene)))
  await Promise.all(
    Array.from({ length: Parallel }, async () => {
      while (queue.length) await queue.shift()()
    }),
  )
} finally {
  await browser.close()
  await server?.close()
  for (const [where, what] of issues.sort()) console.log(`✗ ${where}: ${what}`)
  console.log(`${screens} screens · ${issues.length ? count(issues.length, 'issue') : 'all checks pass'} · images in ${Out}/`)
}
process.exit(issues.length ? 1 : 0)
