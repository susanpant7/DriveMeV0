import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// No <StrictMode>: in development it mounts, unmounts and re-mounts the 3D canvas, and the 3D library force-loses the WebGL
// context on every unmount. Browsers count that as "the page caused context loss" and, after a few, block WebGL for the page.
createRoot(document.getElementById('root')!).render(<App />)
