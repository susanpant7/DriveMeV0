import { useEffect, useState } from 'react'

const read = () => ({
  // touch controls for phones / tablets (and any very narrow window)
  touch: window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 900,
  portrait: window.innerHeight > window.innerWidth,
})

export function useViewport() {
  const [v, setV] = useState(read)
  useEffect(() => {
    const on = () => setV(read())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return v
}
