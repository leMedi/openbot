import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDesktopLivenessDetector,
  desktopReconnectDelay,
  type DesktopLivenessCounters,
} from './desktop-liveness'

function counters(patch: Partial<DesktopLivenessCounters> = {}): DesktopLivenessCounters {
  return { keys: 0, clicks: 0, moves: 0, drawOps: 0, inBytes: 0, ...patch }
}

test('reports one stalled episode after impactful input receives no remote activity', () => {
  const detector = createDesktopLivenessDetector()

  assert.equal(detector.sample(0, counters()), null)
  assert.equal(detector.sample(5_000, counters({ keys: 2 })), null)
  const report = detector.sample(10_000, counters({ keys: 2, clicks: 1, moves: 4 }))

  assert.deepEqual(report, {
    phase: 'post_connect',
    stallMs: 5_000,
    keys: 2,
    clicks: 1,
    moves: 4,
    inBytes: 0,
  })
  assert.equal(detector.sample(11_000, counters({ keys: 3, clicks: 1, moves: 4 })), null)
})

test('remote drawing and network bytes prevent a stall report', () => {
  const detector = createDesktopLivenessDetector()

  detector.sample(0, counters())
  detector.sample(5_000, counters({ keys: 3, drawOps: 1 }))

  assert.equal(detector.sample(10_000, counters({ keys: 3, drawOps: 1, inBytes: 20 })), null)
})

test('remote traffic recovers and rearms stall detection', () => {
  const detector = createDesktopLivenessDetector()

  detector.sample(0, counters())
  detector.sample(5_000, counters({ keys: 3 }))
  assert.notEqual(detector.sample(10_000, counters({ keys: 3 })), null)
  assert.equal(detector.sample(11_000, counters({ keys: 3, inBytes: 20 })), null)
  detector.sample(20_000, counters({ keys: 6, inBytes: 20 }))

  assert.notEqual(detector.sample(21_001, counters({ keys: 6, inBytes: 20 })), null)
})

test('uses bounded exponential reconnect delays', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 20].map(desktopReconnectDelay), [
    1_000,
    2_000,
    4_000,
    8_000,
    10_000,
    10_000,
  ])
})
