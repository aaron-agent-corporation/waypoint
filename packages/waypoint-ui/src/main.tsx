import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@xyflow/react/dist/style.css'
import { App } from './App'
import { createBrowserEngineClient } from './engine/client'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App client={createBrowserEngineClient()} />
  </StrictMode>,
)
