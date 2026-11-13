// Draws everything that comes from public/icon.svg, the one drawing of the Ekitten: the card back's
// mark (paper, its eyes cut out), the 32 px favicon, the home-screen icon (square: the phone rounds
// it) and the Ekitten card's art (the cat on the card's red disc, 500 px like every card's art).
// Usage: npm run icons
import { readFileSync, writeFileSync } from 'node:fs'
import { chrome } from './chrome.mjs'

const Ink = '#141413'
const Paper = '#faf9f5'

const svg = readFileSync('public/icon.svg', 'utf8')
// Each edit below expects icon.svg as drawn: if one finds nothing, stop rather than write a wrong icon.
const must = (ok, what) => {
  if (!ok) throw new Error(`public/icon.svg: no ${what}`)
}
must(svg.includes('<g id="mark"'), '<g id="mark">')
must(/ rx="[\d.]+"/.test(svg), 'rounded corner (rx)')
const mark = svg.slice(svg.indexOf('<g id="mark"'), svg.lastIndexOf('</svg>'))
const eyes = new RegExp(`<path fill="${Ink}" d="([^"]+)"/>\\s*<path fill="${Paper}" d="([^"]+)"/>`)
must(eyes.test(mark), 'body followed by its eyes')

// In paper on the back's own color: the ink turns paper, and the eyes become holes in the body.
const back = mark.replace(eyes, `<path fill="${Paper}" fill-rule="evenodd" d="$1 $2"/>`).replaceAll(Ink, Paper)
writeFileSync('public/back-mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  ${back.trim()}\n</svg>\n`)

const kitten =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><circle cx="250" cy="250" r="246" fill="#c4513a"/>' +
  // Smaller than on the square tile, so the cat sits inside the round disc.
  `<g transform="translate(250 250) scale(4.4) translate(-50 -50)">${mark}</g></svg>`

const browser = await chrome()
for (const [file, size, source] of [
  ['public/icon-32.png', 32, svg],
  ['public/apple-touch-icon.png', 180, svg.replace(/ rx="[\d.]+"/, '')],
  ['public/cards/exploding-kitten.png', 500, kitten],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<body style="margin:0">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`)
  await page.screenshot({ path: file, omitBackground: true })
  await page.close()
}
await browser.close()
