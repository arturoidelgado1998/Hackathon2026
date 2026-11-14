// Entry for driver.html. Deliberately separate from src/main.tsx so a phone
// never downloads the dashboard or the ArcGIS map.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { DriverPage } from './DriverPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DriverPage />
  </StrictMode>,
)
