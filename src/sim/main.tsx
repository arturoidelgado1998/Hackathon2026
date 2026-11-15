// Entry for simulation.html: the truck simulation on its own page, with
// settings a teammate can open from a link.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { SimulationPage } from './SimulationPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SimulationPage />
  </StrictMode>,
)
