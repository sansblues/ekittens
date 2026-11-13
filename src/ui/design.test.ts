import { describe, expect, it } from 'vitest'
import { Kinds } from '../engine'
import { CssVars, NamedWidth } from './design'
import css from './styles.css?raw'

// The design system holds only if nothing steps around it: every value comes from a token, every token is
// used, and the stylesheet and the code say each thing once.

const root = css.match(/^:root \{[\s\S]*?^\}/m)![0]
const rules = css.replace(root, '').replace(/\/\*[\s\S]*?\*\//g, '')
const sources = import.meta.glob<string>(['./*.ts', './*.tsx', '!./*.test.ts', '!./design.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const code = Object.entries(sources).map(([f, src]) => ({ f: f.slice(2), src }))
/** Code without its comments, so only what runs (or shows) is checked. */
const bare = (src: string) => src.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
/** Every `prop: value` declared outside :root. */
const values = (prop: string) => [...rules.matchAll(new RegExp(`(?<![-\\w])${prop}:\\s*([^;]+);`, 'g'))].map((m) => m.at(-1)!.trim())

describe('design system', () => {
  it('takes every color, type, corner, layer and timing from a token', () => {
    // Colors live on :root; a card's own tint (--c) is the one mix made in place.
    expect(rules.match(/#[\da-f]{3,8}\b|rgba?\(|(hsl|hwb|lab|lch|oklab|oklch)\(/gi)).toBeNull()
    expect([...rules.matchAll(/color-mix\([^;]*/g)].map((m) => m[0]).filter((m) => !m.includes('var(--c)'))).toEqual([])
    const plain = /^(var\(--[\w-]+\)|currentColor|transparent|none|inherit)$/
    expect(values('(color|fill|stroke|background-color|border-color|outline-color)').filter((v) => !plain.test(v))).toEqual([])
    // In code too: no color, size, corner or layer written in place.
    const inline = /\b(color|background|fontSize|borderRadius|zIndex):\s*['"`#\d]/
    expect(code.filter(({ src }) => inline.test(bare(src))).map(({ f }) => f)).toEqual([])
    expect(values('font').filter((v) => v !== 'inherit')).toEqual([])
    // Five sizes; only a card's name and the logo size themselves to their box.
    expect(values('font-size').filter((v) => !/^var\(--(text|table)-\w+\)$/.test(v) && !/--name|--logo/.test(v))).toEqual([])
    expect(values('font-weight').filter((v) => v !== '400' && v !== '700')).toEqual([])
    expect(values('line-height').filter((v) => v !== '1' && !/^var\(--(leading|chip)/.test(v))).toEqual([])
    expect(values('letter-spacing').filter((v) => !/^var\(--tracking-\w+\)$/.test(v))).toEqual([])
    // Tiny, almost-square corners: the interface's, a card's (a share of its width), or a shape's own.
    expect(values('border-radius').filter((v) => !/^(var\(--radius\)|max\(var\(--radius\), .*\)|\d+(\.\d+)?%|inherit|0)$/.test(v))).toEqual(
      [],
    )
    // The table's named layers, or just above a sibling.
    expect(values('z-index').filter((v) => v !== '1' && !/^var\(--z-\w+\)$/.test(v))).toEqual([])
    // Durations from design.ts, in CSS and in code.
    expect(values('(transition|animation)(-duration|-delay)?').filter((v) => /\d(m?s)\b/.test(v))).toEqual([])
    const literal = /\b(duration|delay):\s*(\d*\.\d|[1-9])|\b(stiffness|damping|bounce|visualDuration|ease):|after\(\s*[\d.]/
    expect(code.filter(({ src }) => literal.test(bare(src))).map(({ f }) => f)).toEqual([])
  })

  it('defines every token it uses, and uses every token it defines', () => {
    const declared = new Set([...css.matchAll(/(--[\w-]+):/g)].map((m) => m[1]))
    const fromCode = new Set([...Object.keys(CssVars), ...code.flatMap(({ src }) => [...src.matchAll(/'(--[\w-]+)'/g)].map((m) => m[1]))])
    const used = [...css.matchAll(/var\((--[\w-]+)/g), ...code.flatMap(({ src }) => [...src.matchAll(/var\((--[\w-]+)/g)])].map(
      (m) => m[1]!,
    )
    // A typo'd var() falls back silently: nothing else would catch it.
    expect(used.filter((v) => !declared.has(v) && !fromCode.has(v) && v !== '--card-')).toEqual([])
    const tokens = [...root.matchAll(/(--[\w-]+):/g)].map((m) => m[1]!).concat(Object.keys(CssVars))
    // A card's tint is read by its kind (card.tsx: `var(--card-${kind})`): one for each kind, and no more.
    const tints = Kinds.map((k) => `--card-${k}`)
    expect(tokens.filter((t) => !tints.includes(t) && !used.includes(t))).toEqual([])
    expect(tints.filter((t) => !tokens.includes(t))).toEqual([])
    // Written onto :root by design.ts: one also declared in styles.css would say a value that never shows.
    expect(Object.keys(CssVars).filter((t) => declared.has(t))).toEqual([])
  })

  it('says each thing once', () => {
    // A container query can't read a variable: the width it names is NamedWidth's.
    expect(css).toContain(`@container (width < ${NamedWidth}px)`)
    // Three widths and three heights lay the screens out, each written one way.
    const media = [...css.matchAll(/@media[^{]*/g)].join(' ')
    expect(media).not.toMatch(/(min|max)-(width|height)/)
    const sizes = [...media.matchAll(/\((width|height)\s*[<>]=?\s*(\d+)px\)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(new Set(sizes)).toEqual(new Set(['width 360', 'width 480', 'width 960', 'height 560', 'height 620', 'height 740']))
  })

  it('writes what it shows with curly apostrophes', () => {
    const straight = code.flatMap(({ f, src }) => [...bare(src).matchAll(/\p{L}'\p{L}/gu)].map((m) => `${f}: ${m[0]}`))
    expect(straight).toEqual([])
  })
})
