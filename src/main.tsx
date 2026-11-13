import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Kinds } from './engine'
import { App } from './ui/app'
import { Guard } from './ui/failed'
import { avatar } from './ui/avatar'
import { Back, art } from './ui/card'
import { CssVars } from './ui/design'
import { Characters } from './lobby'
import './ui/styles.css'

// Every image fetched up front, so no card is blank the first time it shows (a kitten mid-slam).
for (const src of [...Kinds.map(art), Back, ...Characters.map((_, k) => avatar(k))]) new Image().src = src

for (const [name, value] of Object.entries(CssVars)) document.documentElement.style.setProperty(name, value)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Guard>
        <App />
      </Guard>
    </MotionConfig>
  </StrictMode>,
)
