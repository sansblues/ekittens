import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright-core'

/** Chrome (or CHROME=path), in one color profile, so every machine reads and writes the same pixels. */
export const chrome = () =>
  chromium.launch({
    args: ['--force-color-profile=srgb'],
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
  })

/** "1 issue", "3 issues". */
export const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Empties `dir` for a run's images. Only a folder right inside shots/: a mistyped path must never delete anything else. */
export function clean(dir) {
  if (dirname(resolve(dir)) !== resolve('shots')) throw new Error(`${dir}: write into shots/<name>`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}
