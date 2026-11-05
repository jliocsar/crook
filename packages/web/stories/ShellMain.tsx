import { createRoot } from 'react-dom/client'

import { CatalogShell } from './CatalogShell.tsx'
import './stories.css'

const ROOT_ELEMENT_ID = 'root'

const root = document.getElementById(ROOT_ELEMENT_ID)

if (root) {
  createRoot(root).render(<CatalogShell />)
}
