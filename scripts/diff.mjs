// Compares two runs of scripts/shots.mjs: lists each screen that changed (how many pixels, and where)
// or is in only one run, draws the changes in red into <out>, and fails if any did.
// Usage: npm run shots:diff [before after out], by default shots/base shots/now shots/diff.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chrome, clean, count } from './chrome.mjs'

// A pixel has changed when its red, green and blue differ by more than this, summed, and when neither
// image has the other's color a pixel away: an edge Chrome placed a subpixel apart hasn't changed.
const Threshold = 24
// Fewer changed pixels than this is rendering noise: a soft edge rastered a little differently from run
// to run (up to about 40 px). A changed word moves hundreds; a changed digit may move fewer, so noisy
// screens are listed too.
const Noise = 50

const [Before = 'shots/base', After = 'shots/now', Out = 'shots/diff'] = process.argv.slice(2)
clean(Out)
const changed = []
const names = [...new Set([Before, After].flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.png'))))].sort()
// Identical files need no look: most screens, most of the time.
const differ = []
for (const f of names) {
  const has = [Before, After].filter((dir) => existsSync(`${dir}/${f}`))
  if (has.length < 2) changed.push(`${f}: only in ${has[0]}`)
  else if (!readFileSync(`${Before}/${f}`).equals(readFileSync(`${After}/${f}`))) differ.push(f)
}
const noisy = []
if (differ.length) {
  const browser = await chrome()
  const page = await browser.newPage()
  const png = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`
  for (const f of differ) {
    const r = await page.evaluate(
      async ([a, b, threshold, noise]) => {
        const load = async (src) => createImageBitmap(await (await fetch(src)).blob())
        const [ia, ib] = await Promise.all([load(a), load(b)])
        const w = Math.max(ia.width, ib.width)
        const h = Math.max(ia.height, ib.height)
        const canvas = (img) => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          const x = c.getContext('2d', { willReadFrequently: true })
          x.drawImage(img, 0, 0)
          return x
        }
        const da = canvas(ia).getImageData(0, 0, w, h).data
        const out = canvas(ib)
        const db = out.getImageData(0, 0, w, h).data
        // The changes in red, over a faded copy of the new image.
        out.fillStyle = 'rgba(255,255,255,0.6)'
        out.fillRect(0, 0, w, h)
        const od = out.getImageData(0, 0, w, h)
        let n = 0
        const box = [w, h, 0, 0]
        const same = (p, q, i, j) => Math.abs(p[i] - q[j]) + Math.abs(p[i + 1] - q[j + 1]) + Math.abs(p[i + 2] - q[j + 2]) <= threshold
        // Whether `q` has `p`'s color at (x, y) within a pixel of it.
        const near = (p, q, x, y) => {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx >= 0 && ny >= 0 && nx < w && ny < h && same(p, q, (y * w + x) * 4, (ny * w + nx) * 4)) return true
            }
          }
          return false
        }
        for (let i = 0; i < da.length; i += 4) {
          if (same(da, db, i, i)) continue
          const x = (i / 4) % w
          const y = Math.floor(i / 4 / w)
          if (near(da, db, x, y) && near(db, da, x, y)) continue
          n++
          box[0] = Math.min(box[0], x)
          box[1] = Math.min(box[1], y)
          box[2] = Math.max(box[2], x)
          box[3] = Math.max(box[3], y)
          od.data.set([230, 40, 40, 255], i)
        }
        if (n < noise) return { n }
        out.putImageData(od, 0, 0)
        return { n, box, png: out.canvas.toDataURL() }
      },
      [png(`${Before}/${f}`), png(`${After}/${f}`), Threshold, Noise],
    )
    if (r.png) {
      changed.push(`${f}: ${r.n} pixels, in ${r.box.join(',')} (x0,y0,x1,y1)`)
      writeFileSync(`${Out}/${f}`, Buffer.from(r.png.split(',')[1], 'base64'))
    } else if (r.n) noisy.push(`${f} (${r.n})`)
  }
  await browser.close()
}
for (const c of changed.sort()) console.log(`✗ ${c}`)
if (noisy.length) console.log(`· rendering noise only: ${noisy.sort().join(', ')}`)
console.log(changed.length ? `${count(changed.length, 'screen')} changed` : 'no changes')
process.exit(changed.length ? 1 : 0)
