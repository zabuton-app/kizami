import { describe, expect, it } from 'vitest'
import {
  PopupTransitionState,
  REMAP_SETTLE_MS,
  TRANSITION_SETTLE_MS
} from '../../src/main/popup-transition-state'

describe('PopupTransitionState', () => {
  it('consumes an active remap correction only once', () => {
    const state = new PopupTransitionState()
    state.armRemap(1000)

    expect(state.consumeRemap(1000 + REMAP_SETTLE_MS - 1)).toBe(true)
    expect(state.consumeRemap(1000 + REMAP_SETTLE_MS - 1)).toBe(false)
  })

  it('does not consume an expired remap correction', () => {
    const state = new PopupTransitionState()
    state.armRemap(1000)

    expect(state.consumeRemap(1000 + REMAP_SETTLE_MS)).toBe(false)
  })

  it('invalidates callbacks from older transitions', () => {
    const state = new PopupTransitionState()
    const first = state.beginTransition(1000)
    const second = state.beginTransition(1100)

    expect(state.isCurrent(first)).toBe(false)
    expect(state.isCurrent(second)).toBe(true)
  })

  it('arms and rearms the transition settle window without changing its generation', () => {
    const state = new PopupTransitionState()
    const generation = state.beginTransition(1000)

    expect(state.isTransitioning(1000 + TRANSITION_SETTLE_MS - 1)).toBe(true)
    expect(state.isTransitioning(1000 + TRANSITION_SETTLE_MS)).toBe(false)

    state.rearmTransition(2000)
    expect(state.isCurrent(generation)).toBe(true)
    expect(state.isTransitioning(2000 + TRANSITION_SETTLE_MS - 1)).toBe(true)
  })

  it('clears remap and nudge guards when a new transition starts', () => {
    const state = new PopupTransitionState()
    state.armRemap(1000)
    state.beginNudge(1000)
    state.beginTransition(1100)

    expect(state.consumeRemap(1100)).toBe(false)
    expect(state.isNudging(1100)).toBe(false)
  })

  it('tracks and finishes a viewport nudge', () => {
    const state = new PopupTransitionState()
    state.beginNudge(1000)

    expect(state.isNudging(1000 + TRANSITION_SETTLE_MS - 1)).toBe(true)
    state.finishNudge()
    expect(state.isNudging(1001)).toBe(false)

    state.beginNudge(2000)
    expect(state.isNudging(2000 + TRANSITION_SETTLE_MS)).toBe(false)
  })
})
