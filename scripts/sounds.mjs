// Makes the game's card sounds (public/sounds/*.wav) from Kenney's Casino Audio (CC0,
// https://kenney.nl/assets/casino-audio). Each take is mixed to mono, cleared of rumble, warmed
// (its highs rolled off: cards on felt, soft and round, not crisp paper), trimmed to its hit (so it
// lands on the frame its card does), faded out, and leveled to one perceived loudness (K-weighted,
// roughly as in BS.1770), so the game sets every sound's level in one place (Level, src/ui/sound.ts).
// Usage: npm run sounds <pack>/Audio
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chrome } from './chrome.mjs'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: npm run sounds <pack>/Audio')
  process.exit(1)
}

// What we keep: [output name, source file, which burst (the n-th loud event in the file, from 0),
// and how long before its peak it starts (s): a landing hits at once; a slide builds into its peak
// the same short way every time; a fan or a riffle starts where it starts].
const Takes = [
  ['slide-1', 'card-slide-1.ogg', 0, 0.015],
  ['slide-2', 'card-slide-2.ogg', 0, 0.015],
  ['slide-3', 'card-slide-3.ogg', 0, 0.015],
  ['slide-4', 'card-slide-6.ogg', 0, 0.015],
  ['place-1', 'card-place-1.ogg', 0, 0.003],
  ['place-2', 'card-place-2.ogg', 'last', 0.003],
  ['place-3', 'card-place-3.ogg', 'last', 0.003],
  ['place-4', 'card-place-4.ogg', 'last', 0.003],
  ['deal', 'card-fan-1.ogg', 'all', null],
  ['shuffle-1', 'card-shuffle.ogg', 1, null],
  ['shuffle-2', 'card-shuffle.ogg', 4, null],
]

// Every take's loudness (LUFS), measured as described where it's leveled below.
const Target = -28
// The warmth: highs rolled off above this (Hz), gently (12 dB an octave).
const Warm = 4500
const Rate = 44100

const browser = await chrome()
const page = await browser.newPage()
const out = await page.evaluate(
  async ({ takes, Target, Rate, Warm }) => {
    const results = []
    for (const [name, b64, which, lead] of takes) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const src = await new OfflineAudioContext(1, 1, Rate).decodeAudioData(bytes.buffer)
      // Mono, rumble removed (high-pass 150 Hz), warmed (low-pass at Warm).
      const ctx = new OfflineAudioContext(1, src.length, Rate)
      const s = ctx.createBufferSource()
      s.buffer = src
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 150
      const warm = ctx.createBiquadFilter()
      warm.type = 'lowpass'
      warm.frequency.value = Warm
      warm.Q.value = 0.6
      s.connect(hp).connect(warm).connect(ctx.destination)
      s.start()
      const x = (await ctx.startRendering()).getChannelData(0)
      // Its bursts: runs of sound above −30 dB of the file's peak, 40 ms of quiet apart.
      let peak = 0
      for (const v of x) peak = Math.max(peak, Math.abs(v))
      const loud = (i) => Math.abs(x[i]) > peak * 0.0316
      const bursts = []
      let start = -1
      let lastLoud = -1
      const gap = Rate * 0.04
      for (let i = 0; i < x.length; i++) {
        if (loud(i)) {
          if (start < 0) start = i
          lastLoud = i
        } else if (start >= 0 && i - lastLoud > gap) {
          bursts.push([start, lastLoud])
          start = -1
        }
      }
      if (start >= 0) bursts.push([start, lastLoud])
      // Bursts within 12 dB of the file's peak are hits; quieter ticks (a finger touching a card) aren't.
      const big = bursts.filter(([a, z]) => {
        let m = 0
        for (let i = a; i <= z; i++) m = Math.max(m, Math.abs(x[i]))
        return m > peak * 0.25
      })
      const burst = which === 'all' ? [big[0]?.[0], big.at(-1)?.[1]] : which === 'last' ? big.at(-1) : big[which]
      if (burst?.[0] === undefined) throw new Error(`${name}: no burst ${which} (it has ${big.length})`)
      const [a, z] = burst
      // From `lead` before its peak (or 3 ms before the burst) to 60 ms after it has died away,
      // faded in over its first 3 ms and out over its last 60.
      const fadeIn = Math.round(Rate * 0.003)
      const fadeOut = Math.round(Rate * 0.06)
      let top = a
      for (let i = a; i <= z; i++) if (Math.abs(x[i]) > Math.abs(x[top])) top = i
      const from = Math.max(0, lead === null ? a - fadeIn : top - Math.round(Rate * lead))
      const to = Math.min(x.length, z + fadeOut)
      const y = x.slice(from, to)
      for (let i = 0; i < fadeIn; i++) y[i] *= i / fadeIn
      for (let i = 0; i < fadeOut; i++) y[y.length - 1 - i] *= (i / fadeOut) ** 2
      // Leveled: its loudest 200 ms, K-weighted (a +4 dB shelf from 1.7 kHz, a high-pass at 38 Hz:
      // how loud it sounds), at Target.
      const k = new OfflineAudioContext(1, y.length, Rate)
      const kb = k.createBuffer(1, y.length, Rate)
      kb.copyToChannel(y, 0)
      const ks = k.createBufferSource()
      ks.buffer = kb
      const shelf = k.createBiquadFilter()
      shelf.type = 'highshelf'
      shelf.frequency.value = 1681
      shelf.gain.value = 4
      const kh = k.createBiquadFilter()
      kh.type = 'highpass'
      kh.frequency.value = 38
      kh.Q.value = 0.5
      ks.connect(shelf).connect(kh).connect(k.destination)
      ks.start()
      const ky = (await k.startRendering()).getChannelData(0)
      const w = Math.round(Rate * 0.2)
      let acc = 0
      let best = 0
      for (let i = 0; i < ky.length; i++) {
        acc += ky[i] ** 2
        if (i >= w) acc -= ky[i - w] ** 2
        best = Math.max(best, acc / w)
      }
      const gain = 10 ** ((Target + 0.691) / 20) / Math.sqrt(best)
      let outPeak = 0
      for (let i = 0; i < y.length; i++) {
        y[i] *= gain
        outPeak = Math.max(outPeak, Math.abs(y[i]))
      }
      if (outPeak >= 1) throw new Error(`${name}: clips at ${Target} LUFS`)
      // 16-bit PCM WAV.
      const data = new DataView(new ArrayBuffer(44 + y.length * 2))
      const str = (o, t) => [...t].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)))
      str(0, 'RIFF')
      data.setUint32(4, 36 + y.length * 2, true)
      str(8, 'WAVEfmt ')
      data.setUint32(16, 16, true)
      data.setUint16(20, 1, true)
      data.setUint16(22, 1, true)
      data.setUint32(24, Rate, true)
      data.setUint32(28, Rate * 2, true)
      data.setUint16(32, 2, true)
      data.setUint16(34, 16, true)
      str(36, 'data')
      data.setUint32(40, y.length * 2, true)
      for (let i = 0; i < y.length; i++) data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, y[i])) * 0x7fff, true)
      const bytesOut = new Uint8Array(data.buffer)
      let bin = ''
      for (let i = 0; i < bytesOut.length; i += 0x8000) bin += String.fromCharCode(...bytesOut.subarray(i, i + 0x8000))
      results.push({ name, wav: btoa(bin), seconds: y.length / Rate, peak: 20 * Math.log10(outPeak) })
    }
    return results
  },
  {
    takes: Takes.map(([name, file, which, lead]) => [name, readFileSync(`${dir}/${file}`).toString('base64'), which, lead]),
    Target,
    Rate,
    Warm,
  },
)
await browser.close()

mkdirSync('public/sounds', { recursive: true })
for (const { name, wav, seconds, peak } of out) {
  writeFileSync(`public/sounds/${name}.wav`, Buffer.from(wav, 'base64'))
  console.log(`${name.padEnd(10)} ${seconds.toFixed(3)} s · peak ${peak.toFixed(1)} dBFS`)
}
