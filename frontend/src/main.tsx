// Must be first: installs the global `Buffer` the bridge SDK needs before any
// other module (which may pull in that SDK) initializes.
import './lib/polyfills'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
