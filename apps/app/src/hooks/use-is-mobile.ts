import { useSyncExternalStore } from 'react'

// Phone-width layout switch. Below this the app becomes a navigation stack
// (list page → conversation page) instead of side-by-side panes.
const QUERY = '(max-width: 767px)'

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // Server render assumes desktop; the client corrects after hydration.
    () => false,
  )
}
