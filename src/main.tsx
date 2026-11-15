import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The page is fed live and starts with only the day's schedule. Adding ?sample
// to the address opens the prefilled sample instead (also used by the sanity checks).
const sample = new URLSearchParams(window.location.search).has('sample')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App live={!sample} />
  </StrictMode>,
)
