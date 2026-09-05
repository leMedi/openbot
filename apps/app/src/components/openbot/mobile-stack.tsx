import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// iOS navigation-stack feel: the detail page slides in from the right over
// the list, which drifts left by a third and dims. Going back reverses it,
// and dragging from the left edge scrubs the same transition interactively.
const PARALLAX = 0.3
const DIM = 0.35
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const DURATION = 400
const EDGE_PX = 32
const COMMIT_FRACTION = 0.35
const COMMIT_VELOCITY = 0.5 // px per ms

type MobileStackProps = {
  showDetail: boolean
  onBack: () => void
  list: React.ReactNode
  detail: React.ReactNode
}

export function MobileStack({ showDetail, onBack, list, detail }: MobileStackProps) {
  const [mounted, setMounted] = useState(showDetail)
  const listRef = useRef<HTMLDivElement>(null)
  const dimRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  // Always starts at the list; a push on mount animates in like any other.
  const progress = useRef(0)
  const drag = useRef<{
    pointerId: number
    startX: number
    lastX: number
    lastT: number
    velocity: number
    width: number
  } | null>(null)

  // progress: 0 = list fully shown, 1 = detail fully shown.
  function apply(p: number, animate: boolean) {
    progress.current = p
    const transition = animate ? `transform ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}` : 'none'
    if (listRef.current) {
      listRef.current.style.transition = transition
      listRef.current.style.transform = `translate3d(${-p * PARALLAX * 100}%, 0, 0)`
    }
    if (dimRef.current) {
      dimRef.current.style.transition = transition
      dimRef.current.style.opacity = String(p * DIM)
    }
    if (detailRef.current) {
      detailRef.current.style.transition = transition
      detailRef.current.style.transform = `translate3d(${(1 - p) * 100}%, 0, 0)`
    }
  }

  useEffect(() => {
    if (showDetail) setMounted(true)
  }, [showDetail])

  // Push: paint the detail page offscreen first, then animate it in. Pop:
  // animate out; the transitionend handler unmounts it.
  useLayoutEffect(() => {
    if (showDetail && mounted) {
      if (progress.current < 1) {
        apply(progress.current, false)
        void detailRef.current?.getBoundingClientRect()
        apply(1, true)
      }
    } else if (!showDetail && mounted) {
      apply(0, true)
    }
  }, [showDetail, mounted])

  function handleTransitionEnd(e: React.TransitionEvent) {
    if (e.target !== detailRef.current || e.propertyName !== 'transform') return
    if (!showDetail && progress.current === 0) setMounted(false)
  }

  // Edge swipe. Native touch listeners rather than pointer events: browsers
  // fire pointercancel once a touch pan starts, even with touch-action set,
  // while touchmove keeps reporting as long as we preventDefault it.
  const showDetailRef = useRef(showDetail)
  showDetailRef.current = showDetail
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  useEffect(() => {
    const el = detailRef.current
    if (!el) return
    const onStart = (e: TouchEvent) => {
      if (!showDetailRef.current || e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientX > EDGE_PX) return
      drag.current = {
        pointerId: t.identifier,
        startX: t.clientX,
        lastX: t.clientX,
        lastT: e.timeStamp,
        velocity: 0,
        width: el.offsetWidth || window.innerWidth,
      }
    }
    const onMove = (e: TouchEvent) => {
      const d = drag.current
      if (!d) return
      const t = Array.from(e.touches).find((x) => x.identifier === d.pointerId)
      if (!t) return
      e.preventDefault()
      const dx = Math.max(0, t.clientX - d.startX)
      const dt = Math.max(1, e.timeStamp - d.lastT)
      d.velocity = (t.clientX - d.lastX) / dt
      d.lastX = t.clientX
      d.lastT = e.timeStamp
      apply(1 - Math.min(1, dx / d.width), false)
    }
    const finish = (cancelled: boolean) => {
      const d = drag.current
      if (!d) return
      drag.current = null
      const travelled = 1 - progress.current
      const commit =
        !cancelled &&
        (travelled > COMMIT_FRACTION || (travelled > 0.05 && d.velocity > COMMIT_VELOCITY))
      if (commit) {
        apply(0, true)
        onBackRef.current()
      } else {
        apply(1, true)
      }
    }
    const onEnd = () => finish(false)
    const onCancel = () => finish(true)
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onCancel)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [mounted])

  return (
    <div className="relative h-full w-full flex-1 overflow-hidden bg-sidebar">
      <div
        ref={listRef}
        className="absolute inset-0 flex will-change-transform"
        aria-hidden={showDetail || undefined}
      >
        {list}
      </div>
      <div
        ref={dimRef}
        className="pointer-events-none absolute inset-0 bg-black"
        style={{ opacity: 0 }}
      />
      {mounted && (
        <div
          ref={detailRef}
          onTransitionEnd={handleTransitionEnd}
          className="absolute inset-0 flex touch-pan-y bg-panel shadow-[-6px_0_24px_rgba(0,0,0,0.4)] will-change-transform"
          style={{ transform: 'translate3d(100%,0,0)' }}
        >
          {detail}
        </div>
      )}
    </div>
  )
}
