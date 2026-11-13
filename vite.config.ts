/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// The page and its rooms must agree on their release, but each build reads this file anew: it's drawn once, and
// kept for the next read.
const shared = globalThis as { release?: string }
const Release = (shared.release ??= Date.now().toString(36))

// Tests run plain TypeScript: they need neither React's transform nor the rooms' server. They read the
// stylesheet as it's written (design.test.ts), which Vitest otherwise hands them empty.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'test' ? [] : [react(), cloudflare()],
  // One release for the page and its rooms: a page left open across a deploy hears it's out of date.
  define: { __RELEASE__: JSON.stringify(Release) },
  test: { css: { include: /styles\.css/ } },
}))
