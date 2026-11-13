// Draws the players' avatars (public/avatars/*.svg) in the cards' cut-paper and ink style: a flat
// muted tile, a figure cut from paper with scissors, brush-pen ink, one accent color at most.
// The characters are the original game's avatars (iffypixy/ekittens), simplified to read at 24 px.
// Every recipe seeds its own wobble, so a re-run redraws the same art exactly.
// Usage: npm run avatars
import { mkdirSync, writeFileSync } from 'node:fs'

const Ink = '#141413'
const Paper = '#faf9f5'
const Shade = '#e8e6dc'
const Stick = '#e8d9b8'
const Brown = '#7a5a44'
const Out = 'public/avatars'

// Each character is one bold silhouette that fills its tile, like the card art: one idea, no props,
// readable at 24 px. Each tile is one of the cards' colors, never a status color.
const Avatars = {
  // The alien: a dome of a head, two eyes up on stalks.
  alien() {
    reseed(67)
    const head = jitter([...arc(250, 360, 168, 150, 180, 360, { wob: 1.5, n: 16 }), [418, 520], [82, 520]], 3)
    const stalk = (a, b) => brush(line(a, b, { n: 10, bend: 4, wob: 0.8 }), 30)
    return (
      tile('#9c86cb') +
      clip(paint(Paper, stalk([196, 260], [168, 138]), stalk([304, 260], [332, 138])) + shape(head, Paper)) +
      shape(dot(168, 120, 58), Paper) +
      shape(dot(332, 120, 58), Paper) +
      eyes(176, 128, 324, 128, 26) +
      ink(brush(sag([206, 352], [294, 352], 18, 12), 20))
    )
  },
  // The corn dog: a big golden corn dog on its stick, leaning, pleased with itself.
  corndog() {
    reseed(41)
    const turn = placeAt(250, 238, 16)
    const dog = jitter(turn([...arc(0, -92, 92, 92, 180, 360, { wob: 0.8, n: 8 }), ...arc(0, 92, 92, 92, 0, 180, { wob: 0.8, n: 8 })]), 2.5)
    return (
      tile('#546e86') +
      clip(paint(Stick, brush(turn(line([0, 150], [0, 340], { wob: 0.4, n: 6 })), 34))) +
      shape(dog, '#d6a843') +
      ink(dot(...turn([[-36, -40]])[0], 20), dot(...turn([[36, -40]])[0], 20)) +
      ink(brush(turn(sag([-40, 18], [40, 18], 16, 12)), 18))
    )
  },
  // The granny: a face under a grey bun, round glasses.
  granny() {
    reseed(53)
    const bun = cut(250, 64, 72, 58, 12)
    const hair = cut(250, 168, 186, 120, 16)
    const face = cut(250, 300, 150, 168, 18)
    const lens = (cx) => brush(loopAt(cx, 288, 54), 18)
    return (
      tile('#5ca9a2') +
      clip(shape(bun, Shade) + shape(hair, Shade) + shape(face, Paper)) +
      ink(lens(186), lens(314), brush(line([238, 284], [262, 284], { wob: 0.3, n: 4 }), 14), dot(186, 292, 16), dot(314, 292, 16)) +
      ink(brush(sag([214, 396], [286, 396], 12, 10), 16))
    )
  },
  // The man with the long hair and the beard: a paper face between brown hair, a big ink beard
  // (like the Beard Cat card's).
  dude() {
    reseed(17)
    const hair = jitter([...arc(250, 200, 170, 170, 182, 358, { wob: 2, n: 14 }), [420, 250], [430, 520], [70, 520], [80, 250]], 3)
    const face = cut(250, 236, 118, 136, 16)
    const beard = jitter(
      [
        [136, 236],
        [156, 300],
        [204, 330],
        [250, 336],
        [296, 330],
        [344, 300],
        [364, 236],
        [372, 340],
        [340, 432],
        [250, 486],
        [160, 432],
        [128, 340],
      ],
      3,
    )
    return (
      tile('#6a9bcc') +
      clip(shape(hair, Brown) + shape(face, Paper) + shape(beard, Ink)) +
      eyes(208, 228, 292, 228, 22) +
      shape(mouth(250, 380, 34, 30), Paper)
    )
  },
  // The blob: a big paper ghost of a thing, dizzy spiral eyes, mouth wide open.
  blob() {
    reseed(29)
    const body = jitter([...arc(250, 250, 168, 176, 180, 360, { wob: 1.5, n: 16 }), [418, 520], [82, 520]], 3)
    const spiral = (cx, cy) =>
      brush(
        Array.from({ length: 40 }, (_, i) => polar(cx, cy, 4 + i * 1.15, i * 24)),
        13,
      )
    return tile('#cf7a9c') + clip(shape(body, Paper)) + ink(spiral(194, 222), spiral(306, 222), mouth(250, 330, 82, 62))
  },
}

// Two ink dot eyes, like the cats on the cards.
function eyes(x1, y1, x2, y2, r) {
  return ink(dot(x1, y1, r), dot(x2, y2, r))
}

// An open mouth: a wide D, flat on top.
function mouth(cx, cy, w, h) {
  return jitter(
    [[cx - w, cy - h * 0.35], [cx + w, cy - h * 0.35], ...arc(cx, cy - h * 0.35, w, h * 1.35, 0, 180, { wob: 1, n: 10 }).slice(1)],
    1.5,
  )
}

// A hand-drawn closed loop, overshooting its start a little, like a pen.
const loopAt = (cx, cy, r) => arc(cx, cy, r, r, -100, 280, { wob: 1.2, n: 40 })

// Maps shapes drawn round their own origin onto the tile, turned by `deg` about (cx, cy).
const placeAt = (cx, cy, deg) => (pts) => {
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c])
}

// An oval cut with scissors: `n` straight snips.
function cut(cx, cy, rx, ry, n) {
  return jitter(
    Array.from({ length: n }, (_, i) => polar(cx, cy, 1, (i / n) * 360).map((v, k) => (k ? cy + (v - cy) * ry : cx + (v - cx) * rx))),
    2.5,
  )
}

let seed = 1
const reseed = (v) => (seed = v)
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
// A tile with the cards' tiny corners: 40 of 500 is 4 px on a face about 50 px across.
const Tile = 'x="4" y="4" width="492" height="492" rx="40"'
const tile = (fill) => `<rect ${Tile} fill="${fill}"/>`
const clip = (body) => `<g clip-path="url(#tile)">${body}</g>`
const shape = (poly, fill) => `<path d="${pathData(poly)}" fill="${fill}"/>`
const paint = (fill, ...polys) => `<g fill="${fill}">${polys.map((p) => `<path d="${pathData(p)}"/>`).join('')}</g>`
const ink = (...polys) => paint(Ink, ...polys)
const pathData = (poly) => `M${poly.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`
const polar = (cx, cy, r, deg) => [cx + Math.cos((deg * Math.PI) / 180) * r, cy + Math.sin((deg * Math.PI) / 180) * r]
const jitter = (poly, amount) => poly.map(([x, y]) => [x + (rand() - 0.5) * 2 * amount, y + (rand() - 0.5) * 2 * amount])
function brush(pts, weight) {
  const phase = rand() * Math.PI * 2
  const last = pts.length - 1
  const left = []
  const right = []
  const sides = []
  pts.forEach(([x, y], i) => {
    const [a, b] = [pts[Math.max(0, i - 1)], pts[Math.min(last, i + 1)]]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
    const t = i / last
    const r = (weight / 2) * (0.84 + 0.16 * Math.sin(Math.PI * t)) * (1 + 0.06 * Math.sin(phase + t * 13))
    sides.push({ normal, r })
    left.push([x + normal[0] * r, y + normal[1] * r])
    right.unshift([x - normal[0] * r, y - normal[1] * r])
  })
  const cap = ([cx, cy], { normal, r }, flip) =>
    Array.from({ length: 9 }, (_, k) => {
      const a = Math.atan2(normal[1], normal[0]) + flip - (Math.PI * (k + 1)) / 10
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
    })
  return [...left, ...cap(pts[last], sides[last], 0), ...right, ...cap(pts[0], sides[0], Math.PI)]
}
function wobble(amplitude) {
  const p1 = rand() * Math.PI * 2
  const p2 = rand() * Math.PI * 2
  return (t) => amplitude * (0.6 * Math.sin(p1 + t * 9) + 0.4 * Math.sin(p2 + t * 17))
}
function line(a, b, { bend = 0, wob, n }) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const length = Math.hypot(dx, dy) || 1
  const [nx, ny] = [-dy / length, dx / length]
  const sway = wobble(wob)
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const offset = bend * Math.sin(Math.PI * t) + sway(t)
    return [a[0] + dx * t + nx * offset, a[1] + dy * t + ny * offset]
  })
}
function arc(cx, cy, rx, ry, from, to, { wob, n }) {
  const sway = wobble(wob)
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const a = ((from + (to - from) * t) * Math.PI) / 180
    const k = 1 + sway(t) / Math.max(rx, ry)
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]
  })
}
function dot(cx, cy, r) {
  return Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2
    const k = 1 + 0.06 * Math.sin(a * 2 + seed)
    return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k * 0.94]
  })
}
const quad = (a, c, b, n) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const u = 1 - t
    return [u * u * a[0] + 2 * t * u * c[0] + t * t * b[0], u * u * a[1] + 2 * t * u * c[1] + t * t * b[1]]
  })
const sag = (a, b, by, n) => quad(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 2 * by], b, n)

mkdirSync(Out, { recursive: true })
for (const [name, recipe] of Object.entries(Avatars)) {
  const body = recipe()
  writeFileSync(
    `${Out}/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><defs><clipPath id="tile"><rect ${Tile}/></clipPath></defs>${body}</svg>\n`,
  )
  console.log(`${Out}/${name}.svg`)
}
